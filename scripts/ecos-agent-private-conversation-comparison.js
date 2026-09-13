#!/usr/bin/env node

process.env.ECOS_AGENT_EVALUATION_KIND = 'conversation';
require('./ecos-agent-private-conflict-comparison');
