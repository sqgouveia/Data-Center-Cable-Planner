// Variáveis mutáveis de nível de aplicação compartilhadas entre app.js e os
// módulos extraídos dele. Ficam num objeto porque um `let` de módulo não pode
// ser reatribuído por quem importa.
export const GLOBAL_STORAGE = 'dc-planner-v7';
export const runtime = { STORAGE: GLOBAL_STORAGE, pan: null };
