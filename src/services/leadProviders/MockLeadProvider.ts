import { LeadFilter, RawLead } from '../../types';
import { LeadProvider } from './LeadProvider';

// Comprehensive mock database seed pools
const MOCK_FIRST_NAMES = [
  'Alexander', 'Beatriz', 'David', 'Sophia', 'Marcus', 'Elena', 'Vikram', 'Priya', 
  'Jonathan', 'Chloe', 'Liam', 'Ananya', 'Benjamin', 'Camila', 'Ethan', 'Fatima',
  'Gabriel', 'Hannah', 'Isaac', 'Julia', 'Karan', 'Laura', 'Michael', 'Nina',
  'Oliver', 'Rachel', 'Samuel', 'Tanya', 'Umar', 'Victoria', 'William', 'Zoe'
];

const MOCK_LAST_NAMES = [
  'Sharma', 'Vanderbilt', 'Chen', 'Patel', 'O\'Connor', 'Gupta', 'Kowalski', 'Al-Mansoor',
  'Sterling', 'Nakamura', 'Rossi', 'Silva', 'Müller', 'Dubois', 'Kim', 'Schneider',
  'Wright', 'Srinivasan', 'Jackson', 'Gomez', 'Novak', 'Larsen', 'Mercer', 'Rao'
];

const MOCK_COMPANIES = [
  'Nexus Digital AI', 'Apex Health Solutions', 'CloudScale Technologies', 
  'Vanguard Capital', 'Quantum BioAnalytics', 'Starlight Media', 
  'Hyperion Logistics', 'Pulse Health Systems', 'BlueWave Consulting', 
  'Nova Dynamics', 'Orbit SaaS', 'Zenith Financial', 'OmniCare Labs',
  'Synergy Global', 'Helix Ventures', 'Optima Edge Tech'
];

const MOCK_HEADLINES = [
  'Scaling B2B revenue & driving digital transformation through technology',
  'Passionate about building high-performing teams & innovative customer solutions',
  'Helping organizations optimize operations & maximize growth potential',
  'Strategic growth leader | Product innovation & market expansion',
  'Healthcare innovation pioneer | Digital patient care & operational excellence',
  'Empowering enterprise teams with next-gen cloud & AI workflow architecture'
];

export class MockLeadProvider implements LeadProvider {
  readonly providerId = 'mock-provider';
  readonly providerName = 'Demo / Mock Provider (Development)';
  readonly isMock = true;

  async search(filters: LeadFilter): Promise<RawLead[]> {
    // Simulate brief network latency for discovery phase
    await new Promise((resolve) => setTimeout(resolve, 800));

    const targetCount = Math.min(Math.max(filters.maxLeads || 50, 1), 500);
    // Generate ~20% extra candidates including duplicate profile URLs and duplicate name/company
    // so the deduplication pipeline can demonstrate real filtering
    const candidatePoolSize = Math.floor(targetCount * 1.25);
    
    const candidates: RawLead[] = [];

    const selectedTitles = filters.jobTitles.length > 0 ? filters.jobTitles : ['Founder', 'CEO', 'Marketing Manager'];
    const selectedIndustries = filters.industry.length > 0 ? filters.industry : ['Technology', 'Healthcare'];
    const country = filters.country || 'United States';
    const city = filters.city || 'Metropolitan Area';
    const seniority = filters.seniority.length > 0 ? filters.seniority[0] : 'Senior';
    const companySize = filters.companySize.length > 0 ? filters.companySize[0] : '11-50';

    for (let i = 0; i < candidatePoolSize; i++) {
      const firstName = MOCK_FIRST_NAMES[i % MOCK_FIRST_NAMES.length];
      const lastName = MOCK_LAST_NAMES[(i * 3) % MOCK_LAST_NAMES.length];
      const fullName = `${firstName} ${lastName}`;
      
      const jobTitle = `${seniority !== 'Entry' && seniority !== 'C-Level' ? seniority + ' ' : ''}${selectedTitles[i % selectedTitles.length]}`;
      const company = MOCK_COMPANIES[i % MOCK_COMPANIES.length];
      const industryName = selectedIndustries[i % selectedIndustries.length];
      const headline = `${jobTitle} at ${company} | ${industryName} | ${MOCK_HEADLINES[i % MOCK_HEADLINES.length]}`;
      
      const username = `${firstName.toLowerCase()}-${lastName.toLowerCase()}-${100 + i}`;
      const profileUrl = `https://www.linkedin.com/in/${username}`;
      
      const connectionsCount = Math.floor(250 + (i * 87) % 2500);
      const connectionsOrFollowers = connectionsCount > 500 ? '500+ connections' : `${connectionsCount} connections`;
      
      const daysAgo = (i * 4) % 45;
      const lastActivityDate = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;

      candidates.push({
        fullName,
        headline,
        currentJobTitle: jobTitle,
        companyName: company,
        location: `${city}, ${country}`,
        profileUrl,
        connectionsOrFollowers,
        lastActivityDate,
        source: 'LinkedIn Public Search (Demo Provider)'
      });
    }

    // Inject intentional duplicate records to test deduplication pipeline
    if (candidates.length >= 4) {
      // Duplicate profile URL (with trailing slash or uppercase query parameter)
      const original = candidates[1];
      candidates.push({
        ...original,
        profileUrl: `${original.profileUrl}/?utm_source=linkedin&ref=search`, // same profile with query
        headline: original.headline + ' (Updated)'
      });

      // Duplicate person (exact same name + company, slight variation in profile URL)
      const originalPerson = candidates[2];
      candidates.push({
        ...originalPerson,
        profileUrl: `https://linkedin.com/in/${originalPerson.fullName.toLowerCase().replace(/\s+/g, '-')}-duplicate`,
        connectionsOrFollowers: '500+ connections'
      });
    }

    return candidates;
  }
}
