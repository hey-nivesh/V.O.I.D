export interface ParsedTicket {
    category: string;
    package_name: string;
    coordinates: Array<{x: number, y: number}>;
}

export class LLMParser {
    /**
     * Parses the unstructured ticket description to extract the application target and S2R coordinates.
     * In the future, this will connect to OpenAI/Claude. For now, it uses a regex-based heuristic AI mock.
     */
    async parseTicket(description: string): Promise<ParsedTicket> {
        console.log("[Triage Envoy] Routing ticket through LLM processing matrix...");
        
        // Default fallbacks
        let category = "UNKNOWN_ISSUE";
        let package_name = "com.android.settings";
        let coordinates = [{"x": 500, "y": 1000}, {"x": 500, "y": 1500}]; // default arbitrary taps
        
        const lowerDesc = description.toLowerCase();
        
        // Heuristic Mock AI Intent parsing
        if (lowerDesc.includes('gallery') || lowerDesc.includes('photo') || lowerDesc.includes('picture')) {
            package_name = "com.oneplus.gallery";
            category = "UI_BUG";
            // Simulate clicking the first item in the gallery
            coordinates = [{"x": 300, "y": 600}]; 
        } 
        else if (lowerDesc.includes('settings') || lowerDesc.includes('wifi') || lowerDesc.includes('bluetooth')) {
            package_name = "com.android.settings";
            category = "UI_BUG";
        }
        else if (lowerDesc.includes('login') || lowerDesc.includes('auth') || lowerDesc.includes('api')) {
            category = "API_FAILURE";
            package_name = "backend.auth.service";
            coordinates = [];
        }

        // Add semantic delay to simulate LLM thinking
        await new Promise(resolve => setTimeout(resolve, 1500));

        console.log(`[Triage Envoy] LLM Intent Extracted: Category[${category}], Target[${package_name}]`);
        
        return {
            category,
            package_name,
            coordinates
        };
    }
}
