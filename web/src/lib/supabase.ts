
import { createClient } from '@supabase/supabase-js';

// Read the Supabase configuration from web/.env.local
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Stop the application if configuration is missing.
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Supabase configuration missing. Check web/.env.local'
  );
}

// Create one shared Supabase client for the React application.
export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);
