
async function testWikidataQuery() {
  // Try querying just consultants
  const query = `
    SELECT ?item ?itemLabel WHERE {
      ?item wdt:P106 wd:Q1802956 .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 5
  `;
  const sparqlUrl = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;

  try {
    const response = await fetch(sparqlUrl, {
      headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'LinkedInLeadFinderTest/1.0' }
    });

    if (!response.ok) {
      console.error(`Query failed with HTTP ${response.status}`);
      return;
    }

    const data = await response.json();
    console.log('Results count:', data.results.bindings.length);
    if(data.results.bindings.length > 0)
      console.log('Sample result:', JSON.stringify(data.results.bindings[0], null, 2));
  } catch (e) {
    console.error('Test query failed:', e);
  }
}

testWikidataQuery();
