// Physical layout and tray-topology engine: row/rack positions, tray
// endpoints, and rack/tray connection geometry. No DOM rendering and no
// app-level side effects (toast, renderAll, etc.) live here on purpose —
// this is the part of the app whose numbers must be physically correct.
import { state } from './state.js';
import { num, uid, $ } from './utils.js';

export const VIEW_PAD = 2500;
const ROW_GAP_VISUAL = 1.00;

export function rowForRack(r){ return r?state.rows.find(x=>x.id===r.rowId):null; }
export function rowIndex(r){ return r?state.rows.findIndex(x=>x.id===r.rowId):-1; }
export function racksInRow(rowId){ return state.racks.filter(r=>r.rowId===rowId).sort((a,b)=>a.index-b.index); }
export function rackAt(rowId,index){ return racksInRow(rowId).find(r=>r.index===index)||null; }
export function makeRack(row,index){ return {id:uid('rack'),rowId:row.id,index,name:`${row.name||'R'}-${String(index+1).padStart(2,'0')}`,units:state.rackUnits,width:state.rackWidth,depth:state.rackDepth,gapAfter:state.rackGap,riseToTray:state.lastUToTray,powerCapacityW:state.rackPowerCapacityW||0,weightCapacityKg:state.rackWeightCapacityKg||0,offset:0,yOffset:0,hasTray:false}; }

export function rowDepth(row){
  // A row has its own fixed layout depth. Changing an individual rack depth
  // must not move the whole row or any other row.
  return Math.max(0.1,num(row?.depth,state.rackDepth));
}
export function geometry(){
  const wrap=$('canvasWrap'), vw=wrap.clientWidth||900, vh=wrap.clientHeight||700;
  const maxSlot=Math.max(1,...state.rows.map(r=>Math.max(0,num(r.rackCount,0))),1);
  const nominalW=Math.max(0.1,num(state.rackWidth,.6));
  const scale=Math.max(95,Math.min(125,(vw-180)/(maxSlot*(nominalW+Math.max(0,num(state.rackGap,.02)))+1)));
  const x0=VIEW_PAD+90; let y=VIEW_PAD+70; const rows=[];
  state.rows.forEach((row,ri)=>{
    if(ri>0){
      const prev=state.rows[ri-1];
      y+=rowDepth(prev)*scale + Math.max(0,num(row.gap,0))*ROW_GAP_VISUAL*scale;
    }
    rows.push({row,y});
  });
  let maxRight=x0+200;
  let maxBottom=y+rowDepth(state.rows[state.rows.length-1]||{id:''})*scale+150;
  state.rows.forEach(row=>racksInRow(row.id).forEach(r=>{
    const x=x0+rowSlotPhysicalX(row,r.index)*scale+num(r.offset,0);
    maxRight=Math.max(maxRight,x+num(r.width,nominalW)*scale+140);
  }));
  return {w:maxRight+VIEW_PAD,h:maxBottom+VIEW_PAD,vw,vh,scale,x0,rows};
}
export function slotPhysicalWidth(row,index){
  const r=rackAt(row.id,index);
  return r?num(r.width,state.rackWidth):num(state.rackWidth,.6);
}
export function slotGapAfter(row,index){
  const r=rackAt(row.id,index);
  return r?Math.max(0,num(r.gapAfter,state.rackGap)):Math.max(0,num(state.rackGap,.02));
}
export function rowSlotPhysicalX(row,index){
  let x=0;
  for(let i=0;i<Math.max(0,index);i++) x+=slotPhysicalWidth(row,i)+slotGapAfter(row,i);
  return x;
}
export function rackRect(r,g){
  const info=g.rows.find(x=>x.row.id===r.rowId);
  const x=g.x0+rowSlotPhysicalX(rowForRack(r),r.index)*g.scale+num(r.offset,0);
  const y=(info?info.y:0)+num(r.yOffset,0);
  const ww=num(r.width,state.rackWidth)*g.scale;
  const hh=num(r.depth,state.rackDepth)*g.scale;
  return{x,y,w:ww,h:hh};
}
export function rackCenter(r,g){const q=rackRect(r,g);return{x:q.x+q.w/2,y:q.y+q.h/2};}

export function rowCenterY(rowIndexValue,g){const info=g.rows[rowIndexValue]; if(!info)return 0; const rs=racksInRow(info.row.id); if(!rs.length)return info.y; const ys=rs.map(r=>rackCenter(r,g).y); return ys.reduce((a,b)=>a+b,0)/ys.length;}
export function rowTrayBounds(row,g){
  const rs=racksInRow(row.id);
  const y=rowCenterY(state.rows.findIndex(x=>x.id===row.id),g);
  if(!rs.length){
    const x=g.x0;
    return {left:x-20,right:x-20,y};
  }
  const rects=rs.map(r=>rackRect(r,g));
  const left=Math.min(...rects.map(q=>q.x));
  const right=Math.max(...rects.map(q=>q.x+q.w));
  return {left:left-20,right:right+20,y};
}
export function trayPointForRowIndex(row,index,g,side){
  const b=rowTrayBounds(row,g);
  if(!b)return {x:g.x0,y:rowCenterY(state.rows.findIndex(x=>x.id===row.id),g)};
  const i=Math.max(0,Number(index)||0);
  const rs=racksInRow(row.id);
  const maxIndex=Math.max(0,Number(row.rackCount||0)-1);
  // Edge interconnections belong to the calha endpoint, never to the edge rack.
  if(side==='left')return {x:b.left,y:b.y};
  if(side==='right')return {x:b.right,y:b.y};
  if(i===0)return {x:b.left,y:b.y};
  if(i===maxIndex)return {x:b.right,y:b.y};
  const ref=rs.find(r=>r.index===i);
  if(ref)return {x:rackCenter(ref,g).x,y:b.y};
  const nominal=num(state.rackWidth,.6)*g.scale;
  let px=0; for(let k=0;k<i;k++) px+=slotPhysicalWidth(row,k)*g.scale+slotGapAfter(row,k)*g.scale;
  return {x:b.left+20+px+nominal/2,y:b.y};
}

// Keep tray endpoints that were snapped to racks physically attached to those
// racks. This makes an existing calha follow changes in rack width, depth or
// spacing without moving free/independent trays. The saved link also preserves
// which side/point of the rack the endpoint was attached to.
export function syncStructuralTrayEndpoints(g){
  if(!g)return;
  // Inter-row calhas created from one rack/fileira to another are structural
  // connections, not free-floating geometry. Their endpoints must be derived
  // from the current rack positions on both rows every render. This makes them
  // follow changes to row spacing as well as rack width/gap changes.
  state.trays.forEach(t=>{
    if(!t?.fromRowId || !t?.toRowId)return;
    const ra=state.rows.find(r=>r.id===t.fromRowId);
    const rb=state.rows.find(r=>r.id===t.toRowId);
    if(!ra||!rb)return;
    const a=trayPointForRowIndex(ra,t.fromIndex,g,t.sideFrom||null);
    const b=trayPointForRowIndex(rb,t.toIndex,g,t.sideTo||null);
    if(a&&Number.isFinite(a.x)&&Number.isFinite(a.y)){t.x1=a.x;t.y1=a.y;}
    if(b&&Number.isFinite(b.x)&&Number.isFinite(b.y)){t.x2=b.x;t.y2=b.y;}
  });
}

export function syncAttachedTrayEndpoints(g){
  if(!g)return;
  syncStructuralTrayEndpoints(g);
  if(!Array.isArray(state.trayRackLinks) || !state.trayRackLinks.length)return;
  state.trayRackLinks.forEach(link=>{
    const t=state.trays.find(x=>x.id===link.trayId);
    const r=state.racks.find(x=>x.id===link.rackId);
    if(!t||!r)return;
    const q=rackRect(r,g);
    let p;
    if(Number.isFinite(Number(link.rx)) && Number.isFinite(Number(link.ry)) && link.connectionKind==='edge'){
      p={x:q.x+Math.max(0,Math.min(1,Number(link.rx)))*q.w,y:q.y+Math.max(0,Math.min(1,Number(link.ry)))*q.h};
    }else{
      switch(link.point){
        case 'left': p={x:q.x,y:q.y+q.h/2}; break;
        case 'right': p={x:q.x+q.w,y:q.y+q.h/2}; break;
        case 'top': p={x:q.x+q.w/2,y:q.y}; break;
        case 'bottom': p={x:q.x+q.w/2,y:q.y+q.h}; break;
        case 'top-left': p={x:q.x,y:q.y}; break;
        case 'top-right': p={x:q.x+q.w,y:q.y}; break;
        case 'bottom-left': p={x:q.x,y:q.y+q.h}; break;
        case 'bottom-right': p={x:q.x+q.w,y:q.y+q.h}; break;
        default: p={x:q.x+q.w/2,y:q.y+q.h/2};
      }
    }
    if(Number(link.end)===0){t.x1=p.x;t.y1=p.y;}
    else {t.x2=p.x;t.y2=p.y;}
  });
}
export function trayLengthPx(t){return Math.hypot(num(t.x2)-num(t.x1),num(t.y2)-num(t.y1));}
export function trayLengthMeters(t,g){syncAttachedTrayEndpoints(g);return trayLengthPx(t)/Math.max(1,g.scale);}

export function trayPointAt(t,tValue){
  const u=Math.max(0,Math.min(1,Number(tValue)||0));
  return {x:num(t.x1)+(num(t.x2)-num(t.x1))*u,y:num(t.y1)+(num(t.y2)-num(t.y1))*u};
}
export function nearestPointOnSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  if(!den)return {x:ax,y:ay,t:0,d:Math.hypot(px-ax,py-ay)};
  let t=((px-ax)*dx+(py-ay)*dy)/den;t=Math.max(0,Math.min(1,t));
  const x=ax+t*dx,y=ay+t*dy;return {x,y,t,d:Math.hypot(px-x,py-y)};
}
export function nearestTrayConnection(ignoreId,x,y,maxDist){
  let best=null,bestD=maxDist;
  state.trays.forEach(t=>{
    if(t.id===ignoreId)return;
    const q=nearestPointOnSegment(x,y,num(t.x1),num(t.y1),num(t.x2),num(t.y2));
    if(q.d<=bestD){best={type:'tray',tray:t,x:q.x,y:q.y,t:q.t,end:q.t<=0.001?'a':q.t>=0.999?'b':null};bestD=q.d;}
  });
  return best;
}
export function rackConnectionPoint(r,g,x,y){
  const q=rackRect(r,g);
  const cx=q.x+q.w/2,cy=q.y+q.h/2;
  const points=[
    {point:'center',x:cx,y:cy,kind:'center'},
    {point:'top',x:cx,y:q.y,kind:'edge',side:'top'},
    {point:'bottom',x:cx,y:q.y+q.h,kind:'edge',side:'bottom'},
    {point:'left',x:q.x,y:cy,kind:'edge',side:'left'},
    {point:'right',x:q.x+q.w,y:cy,kind:'edge',side:'right'},
    {point:'top-left',x:q.x,y:q.y,kind:'edge',side:'top-left'},
    {point:'top-right',x:q.x+q.w,y:q.y,kind:'edge',side:'top-right'},
    {point:'bottom-left',x:q.x,y:q.y+q.h,kind:'edge',side:'bottom-left'},
    {point:'bottom-right',x:q.x+q.w,y:q.y+q.h,kind:'edge',side:'bottom-right'}
  ];
  points.forEach(p=>p.d=Math.hypot(x-p.x,y-p.y));
  return {center:points[0],edgePoints:points.slice(1),points};
}
export function nearestTrayOrRackSnap(ignoreTrayId,x,y,maxDist){
  const g=geometry();
  let best=null,bestD=maxDist;

  // 1) Existing tray-to-tray connection remains fully free-form: any point
  // along another calha can be used as a junction.
  const tray=nearestTrayConnection(ignoreTrayId,x,y,maxDist);
  if(tray){best=tray;bestD=Math.hypot(x-tray.x,y-tray.y);}

  // 2) Rack snap targets are deliberately discrete: center + center of each
  // lateral + four corners. We also detect when an existing tray passes close
  // to one of these exact rack anchors. In that situation, the preferred snap
  // is the rack anchor itself, while the tray junction is stored at the
  // corresponding point along the existing tray. This lets an intermediate
  // calha be connected cleanly at the rack's center/corner instead of ending
  // a few pixels away from the rack anchor.
  state.racks.forEach(r=>{
    const rc=rackConnectionPoint(r,g,x,y);
    const candidates=rc.points;
    candidates.forEach(c=>{
      const d=Math.hypot(x-c.x,y-c.y);
      if(d>maxDist)return;
      let linkedTray=null,linkedHit=null,linkedDist=Infinity;
      state.trays.forEach(other=>{
        if(other.id===ignoreTrayId)return;
        const hit=nearestPointOnSegment(c.x,c.y,num(other.x1),num(other.y1),num(other.x2),num(other.y2));
        if(hit.d<linkedDist){linkedDist=hit.d;linkedTray=other;linkedHit=hit;}
      });

      // A tray is considered to pass through a rack snap anchor when it is
      // physically close enough to that exact point. The allowance is slightly
      // larger than the ordinary mouse snap distance so small visual offsets
      // caused by zoom do not prevent a clean infrastructure junction.
      const trayAnchorTol=Math.min(Math.max(10,g.scale*0.08),Math.max(16,maxDist));
      const hasTrayAnchor=!!linkedTray && linkedDist<=trayAnchorTol;
      const result={type:hasTrayAnchor?'rack-tray':'rack',rack:r,x:c.x,y:c.y,point:c.point};
      if(c.kind==='edge'){
        result.connectionKind='edge';
        result.side=c.side;
        const q=rackRect(r,g);
        result.rx=(c.x-q.x)/Math.max(q.w,1);
        result.ry=(c.y-q.y)/Math.max(q.h,1);
      }else{
        result.connectionKind='center';
        result.rx=.5; result.ry=.5;
      }
      if(hasTrayAnchor){
        result.tray=linkedTray;
        result.trayX=linkedHit.x;
        result.trayY=linkedHit.y;
        result.trayT=linkedHit.t;
        // Prefer the exact rack anchor whenever the cursor is close to it.
        // Only fall back to a free tray target when the anchor is not in range.
        if(d<=bestD+6){best=result;bestD=d;}
      }else if(d<=bestD){
        best=result;bestD=d;
      }
    });
  });
  return best;
}
export function linkTrayPoints(aTray,aT,bTray,bT){
  const exists=state.trayLinks.some(l=>
    (l.aTray===aTray&&Math.abs((l.aT??(l.aEnd==='a'?0:1))-aT)<0.002&&l.bTray===bTray&&Math.abs((l.bT??(l.bEnd==='a'?0:1))-bT)<0.002)||
    (l.aTray===bTray&&Math.abs((l.aT??(l.aEnd==='a'?0:1))-bT)<0.002&&l.bTray===aTray&&Math.abs((l.bT??(l.bEnd==='a'?0:1))-aT)<0.002));
  if(!exists)state.trayLinks.push({aTray,aT,bTray,bT});
}
export function segmentIntersection(a,b,c,d){
  const r={x:b.x-a.x,y:b.y-a.y}, s={x:d.x-c.x,y:d.y-c.y};
  const cross=(u,v)=>u.x*v.y-u.y*v.x;
  const den=cross(r,s);
  const qmp={x:c.x-a.x,y:c.y-a.y};
  if(Math.abs(den)<1e-9)return null;
  const t=cross(qmp,s)/den, u=cross(qmp,r)/den;
  if(t<-1e-6||t>1+1e-6||u<-1e-6||u>1+1e-6)return null;
  return {x:a.x+t*r.x,y:a.y+t*r.y,tA:Math.max(0,Math.min(1,t)),tB:Math.max(0,Math.min(1,u))};
}
export function trayLinkExistsAt(aTray,aT,bTray,bT,tol=0.002){
  return state.trayLinks.some(l=>{
    const la=l.aTray===aTray&&l.bTray===bTray&&Math.abs((l.aT??0)-aT)<=tol&&Math.abs((l.bT??0)-bT)<=tol;
    const lb=l.aTray===bTray&&l.bTray===aTray&&Math.abs((l.aT??0)-bT)<=tol&&Math.abs((l.bT??0)-aT)<=tol;
    return la||lb;
  });
}

// Remove automatically-created crossing junctions as soon as their geometry
// stops representing a real intersection. This runs during render so a stale
// junction cannot remain visible until another selection/render event.
export function cleanupAutoCrossingLinks(){
  if(!Array.isArray(state.trayLinks)||!state.trayLinks.length)return;
  state.trayLinks=state.trayLinks.filter(l=>{
    if(!l.autoCrossing)return true;
    const a=state.trays.find(t=>t.id===l.aTray);
    const b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return false;
    const hit=segmentIntersection(
      {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
      {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
    );
    if(!hit)return false;
    const aT=Number.isFinite(l.aT)?l.aT:(l.aEnd==='a'?0:1);
    const bT=Number.isFinite(l.bT)?l.bT:(l.bEnd==='a'?0:1);
    // The saved junction must still be at the current physical intersection.
    if(Math.abs(hit.tA-aT)>0.002||Math.abs(hit.tB-bT)>0.002)return false;
    // A crossing is only a real infrastructure junction when at least one
    // of the two trays is fully connected at both endpoints.
    const fullyA=trayEndpointConnected(a.id,0)&&trayEndpointConnected(a.id,1);
    const fullyB=trayEndpointConnected(b.id,0)&&trayEndpointConnected(b.id,1);
    return fullyA||fullyB;
  });
}
export function updateLinksForTray(id){
  // Existing links use normalized positions, so they follow the calha when it moves.
  // A simple crossing is NOT a connection while the calha is being dragged.
}
export function trayEndpointConnected(trayId,end){
  const t=state.trays.find(x=>x.id===trayId);
  if(!t)return false;
  const ex=end===0?num(t.x1):num(t.x2);
  const ey=end===0?num(t.y1):num(t.y2);

  // 1) Explicit links created by the snap interaction.
  const viaTray=state.trayLinks.some(l=>{
    const a=l.aTray===trayId && Math.abs((l.aT??(l.aEnd==='a'?0:1))-end)<0.002;
    const b=l.bTray===trayId && Math.abs((l.bT??(l.bEnd==='a'?0:1))-end)<0.002;
    return a||b;
  });
  if(viaTray)return true;
  const viaRack=state.trayRackLinks.some(l=>l.trayId===trayId && l.end===end);
  if(viaRack)return true;

  // 2) Geometry fallback. A connection is also valid when the endpoint is
  // physically sitting on a rack connection point or on another tray. This
  // makes the routing robust even if an older project has the geometry but
  // is missing the corresponding link record.
  const g=geometry();
  const tol=6;
  for(const r of state.racks){
    const rc=rackConnectionPoint(r,g,ex,ey);
    const candidates=rc.points;
    if(candidates.some(pt=>pt.d<=tol))return true;
  }
  for(const other of state.trays){
    if(other.id===trayId)continue;
    const q=nearestPointOnSegment(ex,ey,num(other.x1),num(other.y1),num(other.x2),num(other.y2));
    if(q.d<=tol)return true;
  }
  return false;
}
export function connectCrossingsForTray(trayId){
  const a=state.trays.find(t=>t.id===trayId); if(!a)return;
  // This is intentionally evaluated only after mouseup, and only when both
  // endpoints are already connected. At that point crossings become real
  // junctions in the infrastructure network.
  if(!trayEndpointConnected(trayId,0)||!trayEndpointConnected(trayId,1))return;
  state.trays.forEach(b=>{
    if(b.id===a.id)return;
    const hit=segmentIntersection(
      {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
      {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
    );
    if(!hit)return;
    // If the intersection is already one of the explicit links, keep it.
    if(trayLinkExistsAt(a.id,hit.tA,b.id,hit.tB))return;
    state.trayLinks.push({aTray:a.id,aT:hit.tA,bTray:b.id,bT:hit.tB,autoCrossing:true});
  });
}
