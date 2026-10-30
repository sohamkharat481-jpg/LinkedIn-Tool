import 'dotenv/config';
import { supabase } from '../src/services/supabase';

async function diagnose() {
  console.log('=== Database Diagnostic ===');
  if (!supabase) {
    console.error('Supabase client not initialized.');
    process.exit(1);
  }

  // 1. Workspaces
  const { data: workspaces, error: wsErr } = await supabase.from('workspaces').select('*');
  console.log('Workspaces count:', workspaces?.length, wsErr?.message || '');
  if (workspaces && workspaces.length > 0) {
    console.log('Workspaces:', workspaces.map((w: any) => ({ id: w.id, name: w.name, owner_id: w.owner_id })));
  }

  // 2. Clients
  const { data: clients, error: clientErr } = await supabase.from('clients').select('*');
  console.log('\nClients count:', clients?.length, clientErr?.message || '');
  if (clients && clients.length > 0) {
    console.log('Clients:', clients.map((c: any) => ({ id: c.id, workspace_id: c.workspace_id, name: c.name })));
  }

  // 3. Leads
  const { data: leads, error: leadErr } = await supabase.from('leads').select('id, workspace_id, profile_url, full_name, company_name');
  console.log('\nLeads count:', leads?.length, leadErr?.message || '');
  if (leads && leads.length > 0) {
    console.log('Sample leads:', leads.slice(0, 5));
  }

  // 4. Client Leads
  const { data: clientLeads, error: clErr } = await supabase.from('client_leads').select('*');
  console.log('\nClient Leads junction count:', clientLeads?.length, clErr?.message || '');
  if (clientLeads && clientLeads.length > 0) {
    console.log('Sample client_leads:', clientLeads.slice(0, 5));
  }

  // 5. Lead Searches
  const { data: searches, error: searchErr } = await supabase.from('lead_searches').select('*');
  console.log('\nLead Searches count:', searches?.length, searchErr?.message || '');
  if (searches && searches.length > 0) {
    console.log('Sample searches:', searches.slice(0, 5));
  }

  // 6. Check for orphaned leads or mismatched IDs
  if (leads && leads.length > 0 && clientLeads) {
    const leadIdSet = new Set(leads.map((l: any) => l.id));
    const clLeadIdSet = new Set(clientLeads.map((cl: any) => cl.lead_id));

    let matched = 0;
    let unmatchedCl = 0;
    for (const cl of clientLeads) {
      if (leadIdSet.has(cl.lead_id)) matched++;
      else unmatchedCl++;
    }
    console.log(`\nJunction Matching Analysis:`);
    console.log(`Total Leads: ${leads.length}`);
    console.log(`Total Client_Leads: ${clientLeads.length}`);
    console.log(`Matched junction -> lead: ${matched}`);
    console.log(`Unmatched client_leads (lead_id NOT in leads): ${unmatchedCl}`);

    // Check if leads match by profile_url
    if (unmatchedCl > 0) {
      console.log('WARNING: Found client_leads pointing to non-existent lead_id in leads table!');
    }
  }
}

diagnose().catch(console.error);
