
async function testWikidataQuery() {
  const query = `
    SELECT ?item ?itemLabel ?itemDescription ?website ?countryLabel WHERE {
      ?item wdt:P31 wd:Q5 .
      ?item wdt:P106/wdt:P279* wd:Q1802956 .
      OPTIONAL { ?item wdt:P856 ?website . }
      OPTIONAL { ?item wdt:P27 ?country . ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
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
    console.log('Sample result:', JSON.stringify(data.results.bindings[0], null, 2));
  } catch (e) {
    console.error('Test query failed:', e);
  }
}

testWikidataQuery();
