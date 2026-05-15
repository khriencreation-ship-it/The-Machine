import * as cheerio from 'cheerio';

export async function scrapeWebsite(url: string): Promise<string> {
  try {
    // Ensure URL has protocol
    const validUrl = url.startsWith('http') ? url : `https://${url}`;
    
    // Fetch the HTML content
    const response = await fetch(validUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    
    // Load HTML into cheerio
    const $ = cheerio.load(html);

    // Remove unwanted elements that add noise to the text
    $('script, style, noscript, iframe, img, svg, nav, footer, header').remove();

    // Extract the raw text
    // We replace multiple newlines/spaces with a single space to clean it up
    const rawText = $('body').text().replace(/\s+/g, ' ').trim();

    if (!rawText) {
      throw new Error("Could not extract any meaningful text from the website.");
    }

    return rawText;
  } catch (error: any) {
    console.error(`Error scraping ${url}:`, error.message);
    throw new Error(`Scraping failed: ${error.message}`);
  }
}
