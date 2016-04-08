// Data Processor
// Processes today's schedule
var ioredis = require('ioredis');
var moment = require('moment');
var scheduler = require('node-schedule');
var underscore = require('underscore');
var config = require('../config.js');
var fs = require('fs')
  , Log = require('log')
  , log = new Log('debug', fs.createWriteStream('../dataprocessor.log'));
// Connect to the redis server
var redis = new ioredis(config.dbport, config.dbaddr);
redis.on('error', function(err) {
  throw err;
});
var redislistener = new ioredis(config.dbport, config.dbaddr);
redislistener.on('error', function(err) {
  throw err;
});
redislistener.subscribe('dataprocessor');
// Define functions
var today,
  currentClass = [],
  nextClass = [],
  remainingTime = [];
var gettoday = function() {
  redis.get('today', function(err, data) {
    if (err) throw err;
    if (data === "No School") {
      today = "No School";
    } else {
      today = JSON.parse(data);
    }
// today = "No School";
  });
};
gettoday(); // We should call this ASAP
var isnow = function() { // determine current class
  log.debug('Running ')
  if (today !== "No School") {
    currentClass = underscore.filter(today, function(item) {
      return moment().isBetween(moment({
        h: item.shour,
        m: item.smin
      }), moment({
        h: item.ehour,
        m: item.emin
      }));
    });
    if (currentClass.length >= 1) redis.set('currentclass', JSON.stringify(currentClass));
    else redis.set('currentclass', "No School");
  } else {
    redis.set('currentclass', "No School");
  }
};

var isnext = function() {
  if (today !== "No School") {
    var upcoming = underscore.filter(today, function(item) {
      return moment().isBefore(moment({
        h: item.shour,
        m: item.smin
      }));
    });
    if (upcoming.length > 0) {
      if (upcoming[0].key_name.slice(-1) !== 0 || currentClass.length == 2) {
        nextClass = upcoming.slice(0, currentClass.length + 1);
      } else {
        nextClass = upcoming.slice(0, 1);
      }
    }
    if (nextClass.length >= 1) redis.set('nextclass', JSON.stringify(nextClass));
    else redis.set('nextclass', "No School");
  } else {
    redis.set('nextclass', "No School");
  }
};

var endsin = function() {
  if (today !== "No School" && currentClass !== "No School") {
    underscore.each(currentClass, function(item) { // do for all in currentclass
      item.etime = moment({
        h: item.ehour,
        m: item.emin
      }); // add etime to item
      item.remainingtime = Math.floor(moment.duration(item.etime.diff(moment())).asMinutes()); //add remainingtime to item
    });
    remainingTime = underscore.pluck(currentClass, 'remainingtime'); //get remainingtime from all entries in currentClass
    redis.set('remainingtime', JSON.stringify(remainingTime)); // set it
  } else {
    redis.set('remainingtime', "No School");
  }
};

var minutejob = scheduler.scheduleJob('0 * * * * *', function() { //called every minute at 0 seconds
  gettoday();
  isnow();
  isnext();
  endsin();
});
minutejob.invoke();
redislistener.on('message', function(channel, message) {
  if (message == 'update') {
    minutejob.invoke();
  }
});

// Reporting to the service list.
// ATTACH THIS TO ALL SERVICES
log.info('Reporting to service set');
redis.zincrby('services', 1, 'dataprocessor'); // add us to the list

process.on('exit', function(code) { // for clean exit
  log.info('Removing from service list');
  redis.zincrby('services', -1, 'dataprocessor'); // remove one instance of it (for scaling)
  redis.quit(); // remove from the server
  redislistener.quit();
});
process.on('SIGINT', function(code) { // for CTRL-C
  process.exit(); // Do regular exit
});
