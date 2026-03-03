'use strict';
// Wait until /app/data is a real mount (not empty container dir)
var fs = require('fs');
var path = '/app/data/attestations.db';
var maxWait = 15;
var interval = 1000;

function check() {
  try {
    var stat = fs.statSync(path);
    // If file exists and is > 4KB, volume is mounted with existing DB
    if (stat.size > 4096) {
      console.log('[wait-volume] Found existing DB: ' + stat.size + ' bytes');
      return true;
    }
  } catch(e) {
    // File doesn't exist yet
  }
  // Also check if /app/data is a mount point
  try {
    var mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    if (mounts.indexOf('/app/data') !== -1) {
      console.log('[wait-volume] /app/data mount detected');
      return true;
    }
  } catch(e) {}
  return false;
}

if (check()) {
  console.log('[wait-volume] Volume ready immediately');
  process.exit(0);
}

var waited = 0;
var timer = setInterval(function() {
  waited += interval;
  if (check() || waited >= maxWait * 1000) {
    if (waited >= maxWait * 1000) {
      console.log('[wait-volume] Timeout - proceeding anyway');
    }
    clearInterval(timer);
    process.exit(0);
  }
  console.log('[wait-volume] Waiting... ' + (waited/1000) + 's');
}, interval);
