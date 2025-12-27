/* ============================================
   Nyx Studio - Supabase 配置
   ============================================ */

const SUPABASE_URL = 'https://bktnjdzosyaojtsehfyz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BYhiltP_5l3QxkH3MM0frQ_p3qGCT5u';

// 创建 Supabase 客户端
// 使用 @supabase/supabase-js v2 CDN 导出的全局对象
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 导出供其他模块使用
window.supabaseClient = supabaseClient;

console.log('Supabase client initialized:', supabaseClient ? 'success' : 'failed');
