// Supabase project connection
// Publishable key is safe to expose in the browser — RLS policies protect the data.

const SUPABASE_URL = 'https://dbyxaarsdsgmwabyljsd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_lA9_XtC3ZtTLyreyz2doSw_L2dHKe98';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
