#!/usr/bin/env node

process.env.ECOS_AGENT_EVALUATION_KIND = 'acceptance';
require('./ecos-agent-private-conflict-comparison');
