"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const diagnostics_1 = require("./features/diagnostics");
const gforth_1 = require("./features/gforth");
const language_1 = require("./features/language");
const navigation_1 = require("./features/navigation");
const indexService_1 = require("./indexService");
function activate(context) {
    const service = new indexService_1.IndexService();
    context.subscriptions.push(service, ...(0, navigation_1.registerNavigation)(service), ...(0, language_1.registerLanguageFeatures)(service), ...(0, diagnostics_1.registerDiagnostics)(service), ...(0, gforth_1.registerGforth)());
    // Indexing runs in the background; the providers work with what is indexed so far.
    service.initialize().catch((error) => {
        console.error('forth-sight: indexing the workspace failed', error);
    });
}
function deactivate() {
    // All resources are released through context.subscriptions.
}
//# sourceMappingURL=extension.js.map