const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados — /radio salvar e /radio favoritos não vão funcionar.');
}

module.exports = url && key ? createClient(url, key) : null;
