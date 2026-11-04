import { getSupabaseServerClient } from '../src/services/supabase';

async function runAudit() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error('Supabase client not initialized.');
    process.exit(1);
  }

  const tables = [
    'leads',
    'clients',
    'workspaces',
    'organizations',
    'team_members',
    'lead_searches',
    'google_integrations',
    'export_history'
  ];

  console.log('--- Production Data Audit ---');
  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`${table}: Error - ${error.message}`);
      } else {
        console.log(`${table}: ${count} records`);
      }
    } catch (e) {
      console.log(`${table}: Error - ${e}`);
    }
  }

  // Check for NULL organization_id
  const { count: nullOrgCount, error: nullOrgError } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .is('organization_id', null);
  
  if (!nullOrgError) {
    console.log(`Leads with NULL organization_id: ${nullOrgCount}`);
  }
}

runAudit();
