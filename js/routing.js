// Cable routing: builds the infrastructure graph (racks + tray network) and
// finds the shortest physical path for a cable, in both automatic and
// manual (user-picked waypoint racks) modes. This is the core precision
// logic of the product - cable length must reflect physical reality.
import { state } from './state.js';
import { num } from './utils.js';
import { breakoutLegCable, pickBreakoutLength } from './breakout-model.js';
import {
  geometry, syncAttachedTrayEndpoints, trayEndpointConnected, connectCrossingsForTray,
  rowForRack, rackRect, nearestPointOnSegment, rowCenterY, segmentIntersection, trayPointAt,
  rackDisplayName
} from './geometry.js';

const U_MM = 44.45;

export function rackCableRiseMeters(r,u,tray){
  const units=Math.max(1,num(r.units,state.rackUnits));
  const usedU=Math.max(1,Math.min(units,Math.floor(num(u,1))));
  // The vertical leg belongs exclusively to the rack. The tray has no
  // height-to-U property; each rack carries its own riseToTray value.
  const rise = Number.isFinite(Number(r.riseToTray)) ? Number(r.riseToTray) : num(state.lastUToTray,1);
  return Math.max(0,(units-usedU)*(U_MM/1000)) + Math.max(0,rise);
}
export function ensureInfrastructureJunctions(){
  // Rebuild any valid crossing junctions before calculating a cable. This is
  // intentionally NOT called while a tray is being dragged. A tray only
  // participates in automatic crossings when both of its endpoints are
  // already connected to a valid destination (rack or tray).
  state.trays.forEach(t=>{
    if(trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1)){
      connectCrossingsForTray(t.id);
    }
  });
}
export function buildRouteGraph(c){
  // Infrastructure-only graph. Crossings are derived from the current geometry
  // at calculation time, but ONLY between trays whose two endpoints are already
  // connected (to racks or to other trays). This keeps dragging non-destructive
  // while guaranteeing that valid cross-row intersections are recognized.
  ensureInfrastructureJunctions();
  const nodes=new Map(),edges=new Map();
  const addNode=(id,n)=>{if(!nodes.has(id)){nodes.set(id,n);edges.set(id,[]);}};
  const connect=(a,b,cost)=>{
    if(!Number.isFinite(cost)||cost<0)return;
    if(!nodes.has(a)||!nodes.has(b))return;
    edges.get(a).push({id:b,cost});edges.get(b).push({id:a,cost});
  };
  const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);
  if(!o||!d)return null;
  const oid=`rack:${o.id}`,did=`rack:${d.id}`;
  addNode(oid,{kind:'rack',rack:o,role:'origin'});
  addNode(did,{kind:'rack',rack:d,role:'dest'});
  const g=geometry();
  syncAttachedTrayEndpoints(g);

  // Build a complete, current set of junction/access parameters for each tray.
  // A junction may come from an explicit endpoint link or from a valid crossing.
  const complete= t => trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1);
  const trayPoints=new Map();
  const crossingPairs=[];
  state.trays.forEach(t=>trayPoints.set(t.id,[]));

  // Explicit tray-to-tray links (including endpoint-to-endpoint snaps).
  state.trayLinks.forEach((l,i)=>{
    const a=state.trays.find(t=>t.id===l.aTray), b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const at=num(l.aT,0),bt=num(l.bT,0);
    trayPoints.get(a.id).push({t:at,kind:'link',linkKey:`${i}:a`});
    trayPoints.get(b.id).push({t:bt,kind:'link',linkKey:`${i}:b`});
  });

  // Origin/destination: only an explicit physical rack connection is valid.
  // The route must start/end at the connection the user created, rather than
  // silently choosing a rack edge or the rack center.
  const explicitRackLinksByRack=new Map();
  state.trayRackLinks.forEach((l,i)=>{
    const t=state.trays.find(x=>x.id===l.trayId),r=state.racks.find(x=>x.id===l.rackId);
    if(!t||!r)return;
    if(r.id!==o.id&&r.id!==d.id)return;
    const arr=explicitRackLinksByRack.get(r.id)||[];
    arr.push({t,numEnd:Number(l.end),link:l,tray:t,linkKey:`rack:${i}`});
    explicitRackLinksByRack.set(r.id,arr);
    trayPoints.get(t.id).push({t:num(l.end,0),kind:'rack',rack:r,explicit:true,linkKey:`rack:${i}`});
  });

  // Intermediate racks are NOT connection points for the cable. They are
  // reference waypoints only and use the physical center of the rack. This
  // lets a same-row tray crossing a rack be understood geometrically without
  // requiring a user-created snap on that intermediate rack.
  const intermediateRacks=state.racks.filter(r=>r.id!==o.id&&r.id!==d.id);
  intermediateRacks.forEach(r=>{
    const row=rowForRack(r),q=rackRect(r,g);
    if(!row||!q)return;
    const cx=q.x+q.w/2,cy=q.y+q.h/2;
    state.trays.forEach(t=>{
      const hit=nearestPointOnSegment(cx,cy,num(t.x1),num(t.y1),num(t.x2),num(t.y2));
      if(hit.d>Math.max(10,g.scale*0.10))return;
      // Only same-row trays can use an intermediate rack as a geometric
      // waypoint. No vertical rise or cable termination is introduced here.
      const rowCenterYVal=rowCenterY(state.rows.indexOf(row),g);
      if(Math.abs(cy-rowCenterYVal)>Math.max(12,g.scale*0.12))return;
      trayPoints.get(t.id).push({t:hit.t,kind:'intermediate-rack',rack:r,center:true});
    });
  });

  // If an origin/destination rack has no explicit snap, infer its access
  // point from a tray that is genuinely usable for that rack's CENTER.
  // Important: do not choose a nearby vertical tray for a different rack just
  // because it is geometrically close. Prefer a tray whose axis crosses the
  // rack center; this keeps 101 -> 202 on rack 202's horizontal tray while
  // still allowing 101 -> 203 to use the vertical tray centered on 203.
  [o,d].forEach(r=>{
    if((explicitRackLinksByRack.get(r.id)||[]).length)return;
    const row=rowForRack(r),q=rackRect(r,g);
    if(!row||!q)return;
    const cx=q.x+q.w/2,cy=q.y+q.h/2;
    let best=null;
    state.trays.forEach(t=>{
      const x1=num(t.x1), y1=num(t.y1), x2=num(t.x2), y2=num(t.y2);
      const dx=x2-x1, dy=y2-y1;
      const horizontal=Math.abs(dx)>=Math.abs(dy);
      const vertical=!horizontal;
      const tolAxis=Math.max(4,g.scale*0.025);
      let eligible=false;

      if(horizontal){
        // A horizontal tray can serve the rack center when the rack center X
        // falls on the tray segment. Its Y may be above/below the rack because
        // the real rack-to-tray leg is vertical and is not part of the plan
        // view.
        const xmin=Math.min(x1,x2)-tolAxis, xmax=Math.max(x1,x2)+tolAxis;
        eligible=cx>=xmin && cx<=xmax;
      }else if(vertical){
        // A vertical tray can serve the rack center only when its X axis is
        // aligned with the rack center. This prevents the vertical tray of
        // rack 203 from being selected as the access for rack 202.
        const ymin=Math.min(y1,y2)-tolAxis, ymax=Math.max(y1,y2)+tolAxis;
        eligible=Math.abs((x1+x2)/2-cx)<=tolAxis && cy>=ymin && cy<=ymax;
      }
      if(!eligible)return;

      const hit=nearestPointOnSegment(cx,cy,x1,y1,x2,y2);
      const score=horizontal ? Math.abs(hit.x-cx)+Math.abs(hit.y-(q.y+q.h/2))*0.15 : hit.d;
      if(!best||score<best.score)best={tray:t,hit,score};
    });
    if(best){
      const t=best.tray,hit=best.hit;
      trayPoints.get(t.id).push({t:hit.t,kind:'rack',rack:r,center:true,explicit:false,fallback:true,linkKey:`center:${r.id}:${t.id}`});
    }
  });
  // A crossing becomes a real junction when at least ONE of the two trays
  // is fully connected at both endpoints. The fully connected tray is the
  // one that authorizes the junction; the other tray does NOT need both
  // endpoints connected. This matches the infrastructure rule: once the
  // tray being positioned has both ends connected (to a rack or another
  // tray), every tray it crosses becomes part of the usable network.
  for(let i=0;i<state.trays.length;i++){
    const a=state.trays[i];
    for(let j=i+1;j<state.trays.length;j++){
      const b=state.trays[j];
      if(!complete(a) && !complete(b))continue;
      const hit=segmentIntersection(
        {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
        {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
      );
      if(!hit)continue;
      const key=`${a.id}:${b.id}`;
      trayPoints.get(a.id).push({t:hit.tA,kind:'cross',crossKey:key});
      trayPoints.get(b.id).push({t:hit.tB,kind:'cross',crossKey:key});
      crossingPairs.push({aTray:a.id,aT:hit.tA,bTray:b.id,bT:hit.tB,key});
    }
  }

  // Add tray nodes, de-duplicate coincident parameters, then connect consecutive
  // points by the actual physical distance along that tray.
  state.trays.forEach(t=>{
    const pts=trayPoints.get(t.id)||[];
    pts.push({t:0,kind:'endpoint'}); pts.push({t:1,kind:'endpoint'});
    pts.sort((a,b)=>a.t-b.t);
    const groups=[];
    for(const pt of pts){
      const last=groups[groups.length-1];
      if(!last || Math.abs(last[0].t-pt.t)>0.000001)groups.push([pt]);
      else last.push(pt);
    }
    const ids=[];
    groups.forEach((group,gi)=>{
      const tv=group.reduce((sum,p)=>sum+p.t,0)/group.length;
      const p=trayPointAt(t,tv);
      const id=`tray:${t.id}:p:${gi}`;
      const rackPt=group.find(x=>x.kind==='rack'&&x.rack);
      addNode(id,{kind:'tray',tray:t,t:tv,x:p.x,y:p.y,access:!!rackPt,rack:rackPt?.rack||null});
      ids.push(id);
      // Same physical point on the same tray is a zero-cost alias.
      for(let k=1;k<group.length;k++){
        const alias=`tray:${t.id}:alias:${gi}:${k}`;
        addNode(alias,{kind:'alias',tray:t,t:tv,x:p.x,y:p.y});
        connect(id,alias,0);
      }
    });
    for(let i=1;i<ids.length;i++){
      const a=nodes.get(ids[i-1]),b=nodes.get(ids[i]);
      const meters=Math.hypot(b.x-a.x,b.y-a.y)/Math.max(1,g.scale);
      connect(ids[i-1],ids[i],meters);
    }
    // Connect every explicit/virtual rack access to its corresponding tray point.
    groups.forEach((group,gi)=>{
      const baseId=ids[gi];
      group.forEach((pt,k)=>{
        if(pt.kind!=='rack'||!pt.rack)return;
        // Only origin/destination racks can terminate a cable. Explicit snaps
        // use their exact physical connection point; the center fallback is
        // permitted only when no explicit connection exists for that rack.
        if(pt.rack.id!==o.id && pt.rack.id!==d.id)return;
        const isExplicit=!!pt.explicit;
        const hasExplicit=(explicitRackLinksByRack.get(pt.rack.id)||[]).length>0;
        if(!isExplicit && hasExplicit)return;
        const aid=`rack:${pt.rack.id}:access:${t.id}:${gi}:${k}`;
        addNode(aid,{kind:'tray',tray:t,t:pt.t,x:trayPointAt(t,pt.t).x,y:trayPointAt(t,pt.t).y,access:true,rack:pt.rack,explicit:isExplicit,centerFallback:!isExplicit});
        connect(baseId,aid,0);
        const u=pt.rack.id===o.id?num(c.originU,1):num(c.destU,1);
        connect(pt.rack.id===o.id?oid:did,aid,c.__routeTopologyOnly?0:rackCableRiseMeters(pt.rack,u,t));
      });
    });
  });

  // Valid crossings are zero-length junctions between the two tray graphs.
  // They are added only after both trays are fully connected.
  for(const pair of crossingPairs){
    const aIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===pair.aTray).sort((x,y)=>Math.abs(x[1].t-pair.aT)-Math.abs(y[1].t-pair.aT));
    const bIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===pair.bTray).sort((x,y)=>Math.abs(x[1].t-pair.bT)-Math.abs(y[1].t-pair.bT));
    if(aIds[0]&&bIds[0])connect(aIds[0][0],bIds[0][0],0);
  }

  // Explicit tray-to-tray snaps are zero-length transitions. Connect the
  // nearest graph nodes at their stored parameters; this covers endpoint snaps.
  state.trayLinks.forEach((l,i)=>{
    const a=state.trays.find(t=>t.id===l.aTray),b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const at=num(l.aT,0),bt=num(l.bT,0);
    const aIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===a.id).sort((x,y)=>Math.abs(x[1].t-at)-Math.abs(y[1].t-at));
    const bIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===b.id).sort((x,y)=>Math.abs(x[1].t-bt)-Math.abs(y[1].t-bt));
    if(aIds[0]&&bIds[0])connect(aIds[0][0],bIds[0][0],0);
  });

  return{nodes,edges,oid,did};
}
export function shortestPathNodes(c){
  const g=buildRouteGraph(c);if(!g)return[];
  const{nodes,edges,oid,did}=g,dist=new Map(),prev=new Map(),used=new Set();
  for(const id of nodes.keys())dist.set(id,Infinity);
  dist.set(oid,0);
  while(used.size<nodes.size){
    let cur=null,best=Infinity;
    for(const[id,d]of dist)if(!used.has(id)&&d<best){best=d;cur=id;}
    if(cur===null)break;
    used.add(cur);if(cur===did)break;
    for(const e of edges.get(cur)||[]){const nd=best+e.cost;if(nd<dist.get(e.id)){dist.set(e.id,nd);prev.set(e.id,cur);}}
  }
  if(!Number.isFinite(dist.get(did)))return[];
  const ids=[];let cur=did;
  while(cur){ids.unshift(cur);if(cur===oid)break;cur=prev.get(cur);}
  return ids[0]===oid?ids:[];
}
export function calcAutomaticTrayLength(c){
  const g=buildRouteGraph(c);if(!g)return{reachable:false,length:0,path:[]};
  const ids=shortestPathNodes(c);if(!ids.length)return{reachable:false,length:0,path:[]};
  let length=0;
  for(let i=1;i<ids.length;i++){
    const a=g.nodes.get(ids[i-1]),b=g.nodes.get(ids[i]);
    const e=(g.edges.get(ids[i-1])||[]).find(x=>x.id===ids[i]);
    if(e)length+=e.cost;
  }
  return{reachable:true,length,path:ids};
}
export function routePointsForAutomatic(c,g){
  const ids=shortestPathNodes(c);if(!ids.length)return[];
  const graph=buildRouteGraph(c),pts=[];
  // The plan-view cable is drawn only along the tray network. The vertical
  // rack-to-tray portions are physical height and are already represented in
  // the numerical calculation; drawing them in the top view creates the
  // unwanted lines through the rack body. Therefore rack nodes are omitted
  // from the visual polyline and only their tray access points are rendered.
  ids.forEach(id=>{
    const n=graph.nodes.get(id);
    if(!n || n.kind!=='tray')return;
    pts.push({x:n.x,y:n.y});
  });
  return dedupeRoutePoints(pts);
}
export function dedupeRoutePoints(pts){
  const out=[];pts.forEach(p=>{if(!out.length||Math.hypot(p.x-out[out.length-1].x,p.y-out[out.length-1].y)>0.5)out.push(p);});return out;
}
export function routeBetweenRacks(aId,bId,c){
  const temp={...c,originRack:aId,destRack:bId,via:[],__routeTopologyOnly:true};
  const res=calcAutomaticTrayLength(temp);
  if(!res.reachable)return null;
  const graph=buildRouteGraph(temp);
  const pts=routePointsForAutomatic(temp,graph);
  return {reachable:true,length:res.length,path:res.path,points:pts};
}
export function manualRouteData(c){
  if(c.originRack===c.destRack)return {reachable:true,length:0,points:[],segments:[]};
  const ids=[c.originRack,...(c.via||[]),c.destRack];
  let total=0,points=[],segments=[];
  for(let i=1;i<ids.length;i++){
    const seg=routeBetweenRacks(ids[i-1],ids[i],c);
    if(!seg)return {reachable:false,length:0,points:[],segments,failedFrom:ids[i-1],failedTo:ids[i]};
    total+=seg.length; segments.push(seg);
    if(seg.points.length){
      if(points.length && Math.hypot(points[points.length-1].x-seg.points[0].x,points[points.length-1].y-seg.points[0].y)<0.5) points.push(...seg.points.slice(1));
      else points.push(...seg.points);
    }
  }
  return {reachable:true,length:total,points:dedupeRoutePoints(points),segments};
}
export function computeRoute(c,g){
  if(c.routeMode==='manual') return manualRouteData(c).points;
  return routePointsForAutomatic(c,g);
}
export function validateManualRouteCandidate(c,rackId){
  if(!rackId || rackId===c.originRack || rackId===c.destRack || (c.via||[]).includes(rackId))return {ok:false,message:'Esse rack não pode ser adicionado à rota.'};
  const seq=[c.originRack,...(c.via||[])];
  const from=seq[seq.length-1];
  const seg=routeBetweenRacks(from,rackId,c);
  if(!seg)return {ok:false,message:`Não existe caminho pelas calhas entre ${rackNameById(from)} e ${rackNameById(rackId)}.`};
  return {ok:true};
}
// Nome do rack nas mensagens e nas listas de rota: com a fileira na frente (A-101), igual aos
// campos de seleção.
export function rackNameById(id){const r=state.racks.find(x=>x.id===id);return (r&&rackDisplayName(r))||id||'?';}
export function calcCable(c){
  const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);
  if(!o||!d)return{v1:0,v2:0,tray:0,connection:0,base:0,slack:0,total:0,reachable:false,path:[]};
  // Cabos entre duas portas/U do MESMO rack não sobem para a calha.
  // O comprimento é somente o percurso vertical interno entre as U.
  if(c.originRack===c.destRack){
    const direct=Math.abs(num(c.originU,1)-num(c.destU,1))*(U_MM/1000);
    const connection=0.30;
    const base=direct+connection;
    const slack=base*(num(c.slack,state.defaultSlack)/100);
    return{v1:direct,v2:0,tray:0,connection,base,slack,total:base+slack,reachable:true,path:[]};
  }
  const manual=c.routeMode==='manual';
  const md=manual?manualRouteData(c):null;
  const rr=manual?{reachable:md.reachable,length:md.length,path:[]} : calcAutomaticTrayLength(c),reachable=rr.reachable;
  const graph=reachable&&!manual?buildRouteGraph(c):null;
  let v1=0,v2=0,tray=manual?Math.max(0,md.length):0;
  if(manual){
    if(md.reachable&&md.segments.length){
      // Manual mode fixes the sequence of racks, but the infrastructure path
      // inside each segment is still chosen by the normal tray graph. The
      // selected racks in `via` are waypoints only: they never add a vertical
      // rack-to-tray leg. The tray distance is therefore the complete
      // topology-only distance, while V1/V2 come only from the actual first
      // and last endpoint connections selected by that same topology route.
      const ids=[c.originRack,...(c.via||[]),c.destRack];

      const firstTo=ids[1] || c.destRack;
      const firstTemp={...c,originRack:c.originRack,destRack:firstTo,via:[],__routeTopologyOnly:true};
      const firstGraph=buildRouteGraph(firstTemp);
      const firstPath=shortestPathNodes(firstTemp);
      if(firstGraph&&firstPath.length>1){
        const firstNode=firstGraph.nodes.get(firstPath[0]);
        const firstNext=firstGraph.nodes.get(firstPath[1]);
        const firstEdge=(firstGraph.edges.get(firstPath[0])||[]).find(x=>x.id===firstPath[1]);
        if(firstNode?.kind==='rack'&&firstNext?.kind==='tray'&&firstEdge){
          v1=rackCableRiseMeters(o,num(c.originU,1),firstNext.tray);
        }
      }

      const lastFrom=ids.length>1 ? ids[ids.length-2] : c.originRack;
      const lastTemp={...c,originRack:lastFrom,destRack:c.destRack,via:[],__routeTopologyOnly:true};
      const lastGraph=buildRouteGraph(lastTemp);
      const lastPath=shortestPathNodes(lastTemp);
      if(lastGraph&&lastPath.length>1){
        const lastNode=lastGraph.nodes.get(lastPath[lastPath.length-2]);
        const lastNext=lastGraph.nodes.get(lastPath[lastPath.length-1]);
        const lastEdge=(lastGraph.edges.get(lastPath[lastPath.length-2])||[]).find(x=>x.id===lastPath[lastPath.length-1]);
        if(lastNode?.kind==='tray'&&lastNext?.kind==='rack'&&lastEdge){
          v2=rackCableRiseMeters(d,num(c.destU,1),lastNode.tray);
        }
      }
    }
  } else if(reachable&&graph){
    const ids=rr.path;
    for(let i=1;i<ids.length;i++){
      const a=graph.nodes.get(ids[i-1]),b=graph.nodes.get(ids[i]),e=(graph.edges.get(ids[i-1])||[]).find(x=>x.id===ids[i]);
      if(!e)continue;
      if(a.kind==='rack'&&b.kind==='tray')v1+=e.cost;
      else if(a.kind==='tray'&&b.kind==='rack')v2+=e.cost;
      else tray+=e.cost;
    }
  }
  const connection=reachable?0.60:0;
  const base=reachable?v1+tray+v2+connection:0;
  const slack=base*(num(c.slack,state.defaultSlack)/100),total=base+slack;
  return{v1,v2,tray,connection,base,slack,total,reachable,path:rr.path};
}
// Tronco comum das pernas de um breakout, em metros de calha. trays[i] = calha da origem até o
// destino i; pairTray(i,j) = calha entre os destinos i e j. Numa rede em árvore o ponto onde as
// rotas de i e j se separam fica a (Ti + Tj − Dij)/2 da origem; o menor entre os pares (e entre
// as próprias rotas) é o trecho comum a todas. Par sem distância conhecida não conta.
export function breakoutSplit(trays,pairTray){
  let trunk=Math.min(...trays);
  for(let i=0;i<trays.length;i++)for(let j=i+1;j<trays.length;j++){const d=pairTray(i,j);if(Number.isFinite(d))trunk=Math.min(trunk,(trays[i]+trays[j]-d)/2);}
  return Math.max(0,trunk);
}
// Breakout: rota de cada perna pelo motor de sempre (folga 0), tronco até a divisão (que pode
// ser dentro do rack de destino, quando as pernas vão para o mesmo rack) e a maior
// perna depois dela, cada um com 0,30 m de conexão e a folga % do breakout. Se alguma perna
// termina no próprio rack da origem, a divisão é na porta. O produto vem de type.lengths.
export function calcBreakout(b,type){
  const legs=(b.legs||[]).filter(l=>l.destRack);
  const res=legs.map(l=>({lane:l.lane,...calcCable({...breakoutLegCable(b,l),slack:0})}));
  const out=res.map(r=>({lane:r.lane,total:r.total,reachable:r.reachable}));
  if(!res.length||!res.every(r=>r.reachable))return{reachable:false,trunkNeeded:0,legNeeded:0,pick:null,reason:null,legs:out};
  const k=1+num(b.slack,state.defaultSlack)/100;
  const atOrigin=legs.map(l=>l.destRack===b.origin.rack);
  let trunkNeeded,legNeeded;
  if(atOrigin.some(Boolean)){
    trunkNeeded=0.30;
    legNeeded=Math.max(...res.map((r,i)=>atOrigin[i]?r.v1+0.30:r.v1+r.tray+r.v2+0.30));
  }else{
    // Caminho de cada perna depois de sair da origem: calhas + descida no rack de destino. Dois
    // destinos no mesmo rack distam só a diferença de U (o tronco desce junto até o mais alto);
    // em racks diferentes, a calha entre eles mais as duas descidas.
    const path=res.map(r=>r.tray+r.v2);
    const trunkPath=breakoutSplit(path,(i,j)=>legs[i].destRack===legs[j].destRack
      ?Math.abs(num(legs[i].destU,1)-num(legs[j].destU,1))*(U_MM/1000)
      :(routeBetweenRacks(legs[i].destRack,legs[j].destRack,{})?.length??Infinity)+res[i].v2+res[j].v2);
    trunkNeeded=Math.max(...res.map(r=>r.v1))+trunkPath+0.30;
    legNeeded=Math.max(...path.map(x=>x-trunkPath))+0.30;
  }
  trunkNeeded*=k; legNeeded*=k;
  const {pick,reason}=pickBreakoutLength(trunkNeeded,legNeeded,type?.lengths);
  return{reachable:true,trunkNeeded,legNeeded,pick,reason,legs:out};
}
