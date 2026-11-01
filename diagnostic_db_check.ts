
import { getSupabaseServerClient } from './src/services/supabase';

async function runDiagnostic() {
  console.log('--- Database Diagnostic Tool ---');
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error('ERROR: Supabase server client could not be initialized. Check environment variables.');
    return;
  }

  const workspaceId = '1f947cad-a738-4e81-8ad9-6ccd99c78033';
  console.log(`Auditing Workspace: ${workspaceId}`);

  // 1. Check workspace existence
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .maybeSingle();
  
  if (wsErr) console.error('Workspace lookup error:', wsErr.message);
  else if (!ws) console.log('Workspace record NOT FOUND in Supabase.');
  else console.log(`Workspace found: "${ws.name}" owned by ${ws.owner_id}`);

  // 2. Check clients
  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId);
  
  if (clientErr) console.error('Clients lookup error:', clientErr.message);
  else {
    console.log(`Clients found: ${clients?.length || 0}`);
    clients?.forEach(c => console.log(` - [${c.id}] ${c.name}`));
  }

  // 3. Check leads
  const { count: leadCount, error: leadErr } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  
  if (leadErr) console.error('Leads count error:', leadErr.message);
  else console.log(`Total leads in public.leads for this workspace: ${leadCount}`);

  // 4. Check client_leads
  const { count: clCount, error: clErr } = await supabase
    .from('client_leads')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  
  if (clErr) console.error('Client leads count error:', clErr.message);
  else console.log(`Total records in public.client_leads for this workspace: ${clCount}`);

  console.log('--- Diagnostic Complete ---');
}

runDiagnostic().catch(console.error);
