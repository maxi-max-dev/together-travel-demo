import {transport} from './transport.mjs';

// Public Pages and the server's /rehearsal/ route share the same local cases.
// Merely opening this guide never creates a trip or calls a provider.
const demoBase=transport.isShowcase?'./':transport.urlFor('/rehearsal/');
for(const link of document.querySelectorAll('[data-demo-path]')){
 link.href=demoBase+link.dataset.demoPath;
}
