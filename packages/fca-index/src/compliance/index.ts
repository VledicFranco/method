/**
 * compliance/ — FCA compliance suggestion domain.
 *
 * Analyzes indexed components for missing FCA parts and generates stub content.
 * No embedding calls — pure SQLite lookup + template generation.
 */

export { ComplianceEngine } from './compliance-engine.js';
export { TemplateGenerator } from './template-generator.js';
