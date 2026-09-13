#!/usr/bin/env node

process.env.ECOS_AGENT_EVALUATION_KIND = 'conversation';
process.env.ECOS_AGENT_COMPARISON_MODELS = 'deepseek-v4-flash';
require('./ecos-agent-private-conflict-comparison');
