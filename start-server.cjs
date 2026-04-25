#!/usr/bin/env node

const { register } = require('tsx/cjs/api');

register();
require('./server.ts');
