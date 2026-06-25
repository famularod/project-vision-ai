import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://niakyydfkrpohqybcock.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_VpiormFj0k6HY5edo10-NQ_foKWfENG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);