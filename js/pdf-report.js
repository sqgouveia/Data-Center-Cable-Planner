import { esc, num, $, beginTask, endTask } from './utils.js';
import { state } from './state.js';
import { isAssetArchived, assetOccupancy, assetsOnFace } from './occupancy.js';
import { geometry } from './geometry.js';
import { capturePlant, bareSvg, svgToPngBlob, blobToDataUrl, niceScale, parseCssColor } from './plant-export.js';

// Funções que continuam em app.js (tocam DOM/estado do app); injetadas por
// configurePdfReport() para evitar import circular com app.js.
let syncActiveRoom, toast, assetWarrantyLevel, assetEndOfLifeLevel, assetsNeedingAttention,
  allProjectRacks, capacityIssues, bayfaceTypeColor, cableSummaryRows, breakoutSummaryRows;
export function configurePdfReport(deps){
  ({ syncActiveRoom, toast, assetWarrantyLevel, assetEndOfLifeLevel, assetsNeedingAttention,
    allProjectRacks, capacityIssues, bayfaceTypeColor, cableSummaryRows, breakoutSummaryRows } = deps);
}

async function ensureJsPDF(){
  if(window.jspdf?.jsPDF)return true;
  if(window.__jspdfLoading)return window.__jspdfLoading;
  window.__jspdfLoading=new Promise(resolve=>{
    const s1=document.createElement('script');
    s1.src='https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
    s1.onload=()=>{
      const s2=document.createElement('script');
      s2.src='https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
      s2.onload=()=>resolve(!!window.jspdf?.jsPDF);
      s2.onerror=()=>resolve(false);
      document.head.appendChild(s2);
    };
    s1.onerror=()=>resolve(false);
    document.head.appendChild(s1);
  });
  return window.__jspdfLoading;
}
function hexToRgb(hex){
  const m=/^#([0-9a-f]{6})$/i.exec(hex||'');
  if(!m)return [148,163,184];
  const n=parseInt(m[1],16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}
function buildRackBayfaceTableBody(rack,face){
  const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
  const assets=assetsOnFace(state.assets,rack.id,face);
  const occupiedByU=new Map();
  assets.forEach(a=>{
    const o=assetOccupancy(a);
    for(let u=Math.max(1,o.start);u<=Math.min(units,o.end);u++)occupiedByU.set(u,a);
  });
  const rows=[]; const startedAssets=new Set();
  // Uma entrada no array por U, sem pular nenhuma. A célula de U NUNCA mescla
  // (cada U sempre mostra o próprio número, mesmo dentro de um equipamento de
  // mais de uma U) — só a célula do equipamento mescla (rowSpan) ao longo do
  // bloco todo.
  for(let u=units;u>=1;u--){
    const asset=occupiedByU.get(u);
    if(asset){
      if(startedAssets.has(asset.id)){
        rows.push([{content:String(u),styles:{halign:'center',fillColor:[235,238,242],fontStyle:'bold'}}]);
        continue;
      }
      startedAssets.add(asset.id);
      const o=assetOccupancy(asset);
      const start=Math.max(1,o.start), end=Math.min(units,o.end);
      const span=end-start+1;
      const name=String(asset.name||asset.assetTag||'Equipamento');
      const tag=asset.assetTag?`Tag: ${asset.assetTag}`:'';
      const sn=asset.serial?`SN: ${asset.serial}`:'';
      const label=span===1?[name,tag,sn].filter(Boolean).join(' - '):`${[name,tag].filter(Boolean).join(' - ')}\n${sn}`;
      const [r,g,b]=hexToRgb(bayfaceTypeColor(asset.type));
      rows.push([
        {content:String(u),styles:{halign:'center',fillColor:[235,238,242],fontStyle:'bold'}},
        {content:label,rowSpan:span,styles:{fillColor:[r,g,b],textColor:255,fontStyle:'bold',valign:'middle'}},
        {content:`${span}U`,rowSpan:span,styles:{fillColor:[r,g,b],textColor:255,halign:'center',valign:'middle',fontStyle:'bold',fontSize:5}},
      ]);
    }else{
      rows.push([{content:String(u),styles:{halign:'center'}},{content:''},{content:''}]);
    }
  }
  return rows;
}
function pickRackTableStyle(units,availableHmm){
  // Escolhe fonte/espaçamento pra caber o rack inteiro numa página só,
  // reduzindo conforme a quantidade de U aumenta. Aplica uma margem de
  // segurança de 10% pra nunca estourar a página por uma estimativa imprecisa.
  const rowH=(availableHmm/units)*0.9;
  if(rowH>=6)return {fontSize:7.5,cellPadding:1.3};
  if(rowH>=4.5)return {fontSize:6,cellPadding:0.9};
  if(rowH>=3.2)return {fontSize:5,cellPadding:0.55};
  if(rowH>=2.4)return {fontSize:4.2,cellPadding:0.35};
  return {fontSize:3.5,cellPadding:0.2};
}

// Página de planta em escala (A4 paisagem). É criada por último e movida para a
// primeira posição, para não mexer na paginação nem na numeração do relatório.
async function addPlantPage(doc){
  const svgEl=document.getElementById('layout');
  if(!svgEl||!state.racks.length)return false;
  const cap=capturePlant(svgEl,{pxPerMeter:geometry().scale});
  if(!cap)return false;
  const {svg,width,height}=bareSvg(cap);
  const dataUrl=await blobToDataUrl(await svgToPngBlob(svg,width,height,2));
  doc.addPage('a4','landscape');
  const pw=doc.internal.pageSize.getWidth(), ph=doc.internal.pageSize.getHeight(), m=14;
  const headerH=26, footerH=cap.legend.length?26:16;
  const availW=pw-m*2, availH=ph-headerH-footerH-m;
  const scale=niceScale(cap.widthM,cap.heightM,availW,availH);
  const wMm=cap.widthM*1000/scale, hMm=cap.heightM*1000/scale;
  const x=m+(availW-wMm)/2, y=headerH+(availH-hMm)/2;
  const room=state.rooms.find(r=>r.id===state.activeRoomId);
  const loc=(state.locations||[]).find(l=>l.id===room?.locationId);
  doc.setTextColor(0); doc.setFont(undefined,'bold'); doc.setFontSize(16);
  doc.text('Planta da sala', m, 16);
  doc.setFont(undefined,'normal'); doc.setFontSize(10);
  doc.text([state.projectName||'Data Center',loc?.name,room?.name].filter(Boolean).join(' / '), m, 22);
  doc.setTextColor(110);
  doc.text(`Escala 1:${scale} (A4 paisagem)`, pw-m, 16, {align:'right'});
  doc.text(new Date().toLocaleDateString('pt-BR'), pw-m, 22, {align:'right'});
  doc.addImage(dataUrl,'PNG',x,y,wMm,hMm,undefined,'FAST');
  doc.setDrawColor(200); doc.setLineWidth(0.2); doc.rect(x,y,wMm,hMm);
  // Barra de escala: 1, 2, 5 ou 10 m, a maior que cabe em ~40 mm.
  const fy=ph-footerH+6;
  const barM=[10,5,2,1,0.5].find(v=>v*1000/scale<=40)||0.5;
  const barMm=barM*1000/scale;
  doc.setDrawColor(0); doc.setLineWidth(0.4);
  doc.line(m,fy,m+barMm,fy); doc.line(m,fy-1.5,m,fy+1.5); doc.line(m+barMm,fy-1.5,m+barMm,fy+1.5);
  doc.setTextColor(0); doc.setFontSize(8);
  doc.text(`${String(barM).replace('.',',')} m`, m+barMm+3, fy+1);
  let lx=m+barMm+30;
  doc.setFontSize(8);
  cap.legend.forEach(item=>{
    const fill=parseCssColor(item.fill), stroke=parseCssColor(item.stroke);
    if(fill)doc.setFillColor(...fill); else doc.setFillColor(220);
    if(stroke)doc.setDrawColor(...stroke);
    doc.setLineWidth(0.2);
    doc.roundedRect(lx,fy-2.5,4,4,0.6,0.6,'FD');
    doc.setTextColor(0);
    doc.text(item.label, lx+6, fy+0.8);
    lx+=6+doc.getTextWidth(item.label)+8;
  });
  doc.movePage(doc.getNumberOfPages(),1);
  return true;
}

export async function generatePDFReport(options={}){
  const opt={summary:true,status:true,lifecycle:true,cables:true,...options};
  beginTask('Gerando relatório PDF…');
  try{
    toast('Gerando relatório...');
    if(!await ensureJsPDF()) throw new Error('Biblioteca de PDF não carregada.');
    syncActiveRoom();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    doc.setFontSize(18); doc.setFont(undefined,'bold'); doc.setTextColor(0);
    doc.text('Relatório do Data Center', margin, 20);
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    doc.text(`Projeto: ${state.projectName||'Sem nome'}`, margin, 28);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, 34);

    const allRacksFull = allProjectRacks();
    const allRacks = options.rackIds?Array.isArray(options.rackIds)?allRacksFull.filter(({rack:r})=>options.rackIds.includes(r.id)):allRacksFull:allRacksFull;
    const activeAssets = state.assets.filter(a=>!isAssetArchived(a));
    const lifecycleIssues = assetsNeedingAttention();
    const capIssues = capacityIssues();
    let y = 40;

    if(opt.summary){
      doc.autoTable({
        startY: 42,
        head: [['Resumo geral', '']],
        body: [
          ['Salas', String(state.rooms.length)],
          ['Racks', String(allRacksFull.length)],
          ['Assets ativos', String(activeAssets.length)],
          ['Cabos cadastrados', String(state.cables.length)],
          ['Alertas de ciclo de vida', String(lifecycleIssues.length)],
          ['Alertas de capacidade', String(capIssues.length)],
        ],
        theme:'grid', styles:{fontSize:9}, headStyles:{fillColor:[31,41,55]},
        columnStyles:{0:{fontStyle:'bold',cellWidth:70}},
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // --- Racks e capacidade ---
    const rackRows = allRacks.map(({rack:r,room})=>{
      const occupied = state.assets.filter(a=>a.rackId===r.id && !isAssetArchived(a)).reduce((s,a)=>s+Math.max(1,Math.floor(num(a.uHeight,1))),0);
      const units = Math.max(1,Math.floor(num(r.units,state.rackUnits)));
      const powerW = state.assets.filter(a=>a.rackId===r.id).reduce((s,a)=>s+Math.max(0,num(a.powerW,0)),0);
      const powerCap = num(r.powerCapacityW,0);
      const weightKg = state.assets.filter(a=>a.rackId===r.id).reduce((s,a)=>s+Math.max(0,num(a.weightKg,0)),0);
      const weightCap = num(r.weightCapacityKg,0);
      return [
        room.name||'—', r.name||'—', `${occupied}U / ${units}U`,
        powerCap>0?`${powerW}W / ${powerCap}W`:`${powerW}W (sem limite)`,
        weightCap>0?`${weightKg}kg / ${weightCap}kg`:`${weightKg}kg (sem limite)`,
      ];
    });
    if(rackRows.length){
      if(y > pageHeight-40){ doc.addPage(); y=20; }
      doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Racks e capacidade', margin, y);
      doc.autoTable({
        startY: y+4,
        head: [['Sala','Rack','Ocupação','Energia','Carga do piso']],
        body: rackRows,
        theme:'striped', styles:{fontSize:8}, headStyles:{fillColor:[31,41,55]},
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // --- Bayface dos racks: tabela simples (U + equipamento), com bordas e
    // linhas mescladas para equipamentos de mais de uma U. Largura estreita,
    // proporcional a um rack de verdade, com vários lado a lado quando couberem.
    // Cada rack tem duas faces independentes (front/rear) — uma seção de páginas
    // por face (todos os racks em Frente, depois nova página com todos em
    // Traseira), não uma tabela por face dentro do mesmo rack: senão um asset
    // da traseira soma na mesma U de um da frente e um dos dois desaparece. ---
    if(allRacks.length){
      const rackColWidth=54, gap=5;
      const racksPerRow=Math.max(1,Math.floor((pageWidth-margin*2+gap)/(rackColWidth+gap)));
      [['front','Frente'],['rear','Traseira']].forEach(([faceKey,faceLabel])=>{
        doc.addPage(); y=20;
        doc.setFontSize(16); doc.setFont(undefined,'bold'); doc.setTextColor(0);
        doc.text(`Bayface dos racks — ${faceLabel}`, margin, y);
        y += 10;
        for(let i=0;i<allRacks.length;i+=racksPerRow){
          // se sobrar pouco espaço na página atual, começa uma nova antes de
          // desenhar essa fileira de racks (evita espremer a fonte à toa)
          if(pageHeight-y-15 < 80){ doc.addPage(); y=20; }
          const availableH=pageHeight-y-15;
          let maxFinalY=y;
          const rowItems=allRacks.slice(i,i+racksPerRow);
          rowItems.forEach((item,idx)=>{
            const x=margin+idx*(rackColWidth+gap);
            const units=Math.max(1,Math.floor(num(item.rack.units,state.rackUnits)));
            doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(0);
            doc.text(`${item.room.name||''} — ${item.rack.name||''}`, x, y, {maxWidth:rackColWidth});
            const style=pickRackTableStyle(units, availableH-6);
            doc.autoTable({
              startY: y+5,
              body: buildRackBayfaceTableBody(item.rack,faceKey),
              theme:'grid',
              styles:{fontSize:style.fontSize,cellPadding:style.cellPadding,lineColor:[200,200,200],lineWidth:0.1},
              columnStyles:{0:{cellWidth:8},2:{cellWidth:8}},
              margin:{left:x},
              tableWidth:rackColWidth,
            });
            maxFinalY=Math.max(maxFinalY, doc.lastAutoTable.finalY);
          });
          y=maxFinalY+14;
        }
      });
    }

    // --- Assets por status ---
    if(opt.status){
      const statusCounts = new Map();
      activeAssets.forEach(a=>{const s=a.status||'—'; statusCounts.set(s,(statusCounts.get(s)||0)+1);});
      if(statusCounts.size){
        if(y > pageHeight-40){ doc.addPage(); y=20; }
        doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Assets por status', margin, y);
        doc.autoTable({
          startY: y+4,
          head: [['Status','Quantidade']],
          body: [...statusCounts.entries()].map(([s,c])=>[s,String(c)]),
          theme:'striped', styles:{fontSize:9}, headStyles:{fillColor:[31,41,55]},
        });
        y = doc.lastAutoTable.finalY + 10;
      }
    }

    // --- Alertas de ciclo de vida ---
    if(opt.lifecycle && lifecycleIssues.length){
      if(y > pageHeight-40){ doc.addPage(); y=20; }
      doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Alertas de ciclo de vida', margin, y);
      const rows = lifecycleIssues.map(a=>{
        const w=assetWarrantyLevel(a), e=assetEndOfLifeLevel(a);
        const reason=[w==='expired'?'Garantia vencida':w==='soon'?'Garantia vence em breve':null,e==='expired'?'EOL vencido':e==='soon'?'EOL vence em breve':null].filter(Boolean).join(' · ');
        return [a.name||a.assetTag||'—', reason];
      });
      doc.autoTable({
        startY: y+4,
        head: [['Asset','Alerta']],
        body: rows,
        theme:'striped', styles:{fontSize:9}, headStyles:{fillColor:[200,80,60]},
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // --- Resumo de cabos ---
    if(opt.cables){
      const cableRows = cableSummaryRows();
      if(cableRows.length){
        if(y > pageHeight-40){ doc.addPage(); y=20; }
        doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Resumo de cabos', margin, y);
        doc.autoTable({
          startY: y+4,
          head: [['Tipo','Comprimento (m)','Quantidade']],
          body: cableRows.map(r=>[r.type, String(r.length), String(r.qty)]),
          theme:'striped', styles:{fontSize:9}, headStyles:{fillColor:[31,41,55]},
        });
      }
      // Breakouts: 1 item por breakout, por tipo + cabo + perna.
      const boRows = breakoutSummaryRows().rows;
      if(boRows.length){
        doc.autoTable({
          startY: (doc.lastAutoTable?.finalY ?? y) + 6,
          head: [['Breakout','Cabo (m)','Perna (m)','Quantidade']],
          body: boRows.map(r=>[r.type+(r.estimated?' (estimado)':''), String(r.m), String(r.leg), String(r.qty)]),
          theme:'striped', styles:{fontSize:9}, headStyles:{fillColor:[31,41,55]},
        });
      }
    }

    // --- Numeração de página ---
    const pageCount = doc.internal.getNumberOfPages();
    for(let i=1;i<=pageCount;i++){
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(140);
      doc.text(`Página ${i} de ${pageCount}`, pageWidth-margin, pageHeight-8, {align:'right'});
    }

    if(opt.plant!==false){
      try{await addPlantPage(doc);}catch(err){console.error('Planta no PDF:',err);toast('O relatório foi gerado sem a planta.');}
    }
    doc.save(`Relatorio_${(state.projectName||'DataCenter').replace(/[^A-Za-z0-9_-]/g,'_')}.pdf`);
    toast('Relatório PDF gerado');
  }catch(err){
    console.error('Erro ao gerar relatório PDF:',err);
    toast('Não foi possível gerar o relatório PDF: '+(err?.message||err));
  }
  finally{endTask();}
}
export function openPdfReportOptions(){
  const m=$('pdfReportOptionsModal');if(!m)return;
  syncActiveRoom();
  const list=$('pdfRacksList');
  if(list){
    const racks=allProjectRacks();
    const byRoom=new Map();
    racks.forEach(({rack:r,room})=>{
      if(!byRoom.has(room.id))byRoom.set(room.id,{room,racks:[]});
      byRoom.get(room.id).racks.push(r);
    });
    let html='';
    byRoom.forEach(({room,racks:roomRacks})=>{
      html+=`<div class="pdf-report-room-group">
        <div class="pdf-report-room-header">
          <input type="checkbox" data-pdf-room="${esc(room.id)}" checked>
          <button type="button" class="pdf-report-room-chevron" data-room-expand="${esc(room.id)}">▸</button>
          <span>${esc(room.name||'Sala')}</span><small>(${roomRacks.length})</small>
        </div>
        <div class="pdf-report-room-racks hidden" data-room-racks="${esc(room.id)}">
          ${roomRacks.map(r=>`<label class="pdf-report-rack-row"><input type="checkbox" data-pdf-rack="${esc(r.id)}" data-pdf-room-of="${esc(room.id)}" checked><span>${esc(r.name||'Rack')}</span></label>`).join('')}
        </div>
      </div>`;
    });
    list.innerHTML=html||'<div class="empty">Nenhum rack no projeto.</div>';
    const updateRoomCheckbox=(roomId)=>{
      const rackBoxes=[...list.querySelectorAll(`[data-pdf-rack][data-pdf-room-of="${roomId}"]`)];
      const roomBox=list.querySelector(`[data-pdf-room="${roomId}"]`); if(!roomBox)return;
      const checkedCount=rackBoxes.filter(cb=>cb.checked).length;
      roomBox.checked=checkedCount===rackBoxes.length;
      roomBox.indeterminate=checkedCount>0&&checkedCount<rackBoxes.length;
    };
    list.querySelectorAll('[data-room-expand]').forEach(btn=>{
      const toggle=()=>{
        const racksEl=list.querySelector(`[data-room-racks="${btn.dataset.roomExpand}"]`);
        const nowHidden=racksEl.classList.toggle('hidden');
        btn.classList.toggle('expanded',!nowHidden);
      };
      btn.addEventListener('click',toggle);
      btn.closest('.pdf-report-room-header').querySelector('span').addEventListener('click',toggle);
    });
    list.querySelectorAll('[data-pdf-room]').forEach(roomBox=>roomBox.addEventListener('change',()=>{
      list.querySelectorAll(`[data-pdf-rack][data-pdf-room-of="${roomBox.dataset.pdfRoom}"]`).forEach(cb=>cb.checked=roomBox.checked);
      roomBox.indeterminate=false;
    }));
    list.querySelectorAll('[data-pdf-rack]').forEach(cb=>cb.addEventListener('change',()=>updateRoomCheckbox(cb.dataset.pdfRoomOf)));
  }
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
}
export function closePdfReportOptions(){const m=$('pdfReportOptionsModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
