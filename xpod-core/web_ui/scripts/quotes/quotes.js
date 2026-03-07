class QuoteManager {
    constructor(jsonPath = '/scripts/quotes/quotes.json') {
        this.jsonPath = jsonPath;
        this.quotes = {};
        this.initialized = this.init();
    }

    async init() {
        try {
            const response = await fetch(this.jsonPath);
            if (!response.ok) {
                throw new Error(`HTTP error. Status: ${response.status}`);
            }
            this.quotes = await response.json();
        } catch (error) {
            console.error("QuoteManager failed to load the dictionary:", error);
        }
    }

    async getRandomQuote(reference) {
        await this.initialized;
        
        const quoteArray = this.quotes[reference];

        if (!quoteArray || !Array.isArray(quoteArray) || quoteArray.length === 0) {
            const fallbackArray = this.quotes['error_general'];
            if (fallbackArray && Array.isArray(fallbackArray) && fallbackArray.length > 0) {
                const fallbackIndex = Math.floor(Math.random() * fallbackArray.length);
                return fallbackArray[fallbackIndex];
            }
            return "Unknown error occurred.";
        }

        const randomIndex = Math.floor(Math.random() * quoteArray.length);
        return quoteArray[randomIndex];
    }
}
window.quoteManager = new QuoteManager();