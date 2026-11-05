
import { WikidataLeadProvider } from '../services/leadProviders/WikidataLeadProvider';
import { LeadFilter } from '../types';

async function auditSearch(title: string, country: string, maxLeads: number = 20) {
  const provider = new WikidataLeadProvider();
  const filters: LeadFilter = {
    jobTitles: [title],
    country: country,
    maxLeads: maxLeads,
    seniority: [],
    industry: [],
    companySize: []
  };

  console.log(`\n=== AUDIT: ${title} in ${country} ===`);
  try {
    const leads = await provider.search(filters);
    
    let relevantCount = 0;
    let excludedCount = 0;
    let withProfileCount = 0;
    let withCompanyCount = 0;

    for (const lead of leads) {
      // Logic for "Relevant professional":
      // 1. Label is a person name (already filtered in provider but we verify here)
      // 2. Headline/Description isn't "actor", "politician", "musician" unless it's the target.
      const desc = (lead.headline || '').toLowerCase();
      const isPublicFigure = desc.includes('politician') || desc.includes('actor') || desc.includes('actress') || 
                             desc.includes('musician') || desc.includes('singer') || desc.includes('athlete') ||
                             desc.includes('footballer') || desc.includes('olympic');
      
      const isMatch = lead.fullName.length > 3 && !isPublicFigure;
      
      if (isMatch) {
        relevantCount++;
        if (lead.linkedInProfileUrl || lead.instagramProfileUrl) withProfileCount++;
        if (lead.companyName && !lead.companyName.includes('Independent')) withCompanyCount++;
      } else {
        excludedCount++;
      }

      console.log(` - [${isMatch ? 'RELEVANT' : 'EXCLUDED'}] ${lead.fullName} | Role: ${lead.currentJobTitle} | Desc: ${lead.headline} | Company: ${lead.companyName}`);
    }

    const total = leads.length;
    const relevantPct = total > 0 ? (relevantCount / total * 100).toFixed(1) : '0';

    return {
      title,
      country,
      total,
      relevantCount,
      excludedCount,
      withProfileCount,
      withCompanyCount,
      relevantPct
    };
  } catch (err: any) {
    console.error(`Audit failed for ${title}: ${err.message}`);
    return null;
  }
}

async function runFullAudit() {
  console.log('--- STARTING LEAD QUALITY AUDIT ---');
  
  const results = [];
  results.push(await auditSearch('Software Engineer', 'Germany'));
  results.push(await auditSearch('Marketing Manager', 'United States'));
  results.push(await auditSearch('Business Coach', 'India'));
  results.push(await auditSearch('Founder', 'United Kingdom')); // "SaaS Founder" is too narrow for QIDs, using Founder.

  console.log('\n\n--- FINAL AUDIT SUMMARY ---');
  console.log('| Search Query | Total | Relevant | Excluded | Profile Links | Company Info | Relevance % |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  
  for (const r of results) {
    if (!r) continue;
    console.log(`| ${r.title} (${r.country}) | ${r.total} | ${r.relevantCount} | ${r.excludedCount} | ${r.withProfileCount} | ${r.withCompanyCount} | ${r.relevantPct}% |`);
  }

  console.log('\nPROVIDER LIMITATIONS:');
  console.log('1. Wikidata primarily indexes notable individuals. "Regular" professionals are rare.');
  console.log('2. Contact information (Email/Phone) is extremely sparse in public Wikidata records.');
  console.log('3. "Employer" data depends on manual entry in Wikidata; many profiles are outdated or incomplete.');
  console.log('4. Search results often include historical or public figures if they ever held the target occupation.');
}

runFullAudit();
