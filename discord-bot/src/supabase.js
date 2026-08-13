const { createClient } = require('@supabase/supabase-js');
// O bot só usa REST (from().select()/.insert()/...), nunca realtime — mas o
// supabase-js cria um RealtimeClient de qualquer jeito dentro do
// createClient, e isso derruba o processo em Node < 22 sem WebSocket
// nativo ("Node.js 20 detected without native WebSocket support"). Passa
// o pacote "ws" como transport pra evitar o crash, mesmo sem usar realtime.
const ws = require('ws');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados — /radio salvar e /radio favoritos não vão funcionar.');
}

module.exports = url && key ? createClient(url, key, { realtime: { transport: ws } }) : null;
