import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ebgnvedocneqkibgnpee.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViZ252ZWRvY25lcWtpYmducGVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NjA2MjIsImV4cCI6MjEwMDQzNjYyMn0.YfqPj0LgI6lrvopSv4IcLbQM5YxdfxG_jSZ4XaU1gsU';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
