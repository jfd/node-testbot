#!/usr/bin/env node
//
// Test Me
//
// Simple and straight-forward test suite with asynchronous support for node.
//
// Copyright (c) 2010 Johan Dahlberg
//
var sys     = require('sys'),
    path    = require('path'),
    posix   = require("posix"),
    events  = require("events");

// Varrious constants
const VERSION         = '0.1';
const DEFAULT_TIMEOUT = 4000;

// Regular expresion contants
const RE_FILE_NAME    = /^test_([A-Za-z0-9]*).js$/;
const RE_TEST_NAME    = /^(at|t)est_([A-Za-z0-9_]*)$/;

var options = {};

/**
 *  Run all tests found in 
 */
function main(args) {
  var sources = [],
      modules = [];

  if (args.length > 0) {
    var arg         = null,
        sourcepath  = null;
        
    while ((arg = args.shift())) {
      if (/^--/.test(arg)) {
        options[arg.substr(2)] = true;

      } else {
        if (/^(\/|\~|\.)/.test(arg)) {
          sourcepath = arg;
        } else {
          sourcepath = process.cwd() + '/' + arg;
        }
        
        sources.push(/\.js$/.test(sourcepath) ? 
                        file_source(sourcepath) : 
                        directory_source(sourcepath));
      }
    }

  } else {
    sources.push(directory_source(process.cwd() + '/'));
  }
  
  function run(modules) {
    if (modules.length) {
      sys.puts('Testbot ' + VERSION + ' - Test suite for node.js');
      sys.puts('Found ' + modules.length + ' available module(s)\n');
      var suite = build_test_suite(modules);
      run_tests(suite, show_result);
    } else {
      sys.puts('Usage: testbot [testdir], [testmodule]');
    }
  }
  
  // process all sources 
  function process_sources(modules) {
    var source = sources.shift()
    if (source) {
      source(modules, process_sources);
    } else {
      run(modules);
    }
  }
  
  process_sources([]);
}

function build_test_suite(modules) {
  return modules.map(function(module_info) {
    var fixture = {
      name:         module_info.name,
      status:       'waiting',
      timeout:      DEFAULT_TIMEOUT,
      reason:       null,
      setup:        null,
      teardown:     null,
      tests:        []
    };
    
    try {
      module = require(module_info.path);
    } catch(err) {
      // Ignore the module in case of error
      fixture.status = 'ignored'; 
      fixture.reason = err;
      return fixture;
    }
    
    // Find test methods
    for (var prop in module) {
      var m = prop.match(RE_TEST_NAME);
      if (m) {
        var async   = (m[1] == 'at'),
            name    = m[2],
            timeout = DEFAULT_TIMEOUT,
            fn      = module[prop];
        
        switch (name) {
          
          // Reserved name. Is called before test is executed. The setup method 
          // can be marked as async.
          case 'setup':
            fixture.setup = create_async_constructor(async, timeout, fn);
            break;

          // Reserved name. Is called after all test is executed. The teardown
          // method can be marked as async.
          case 'teardown':
            fixture.teardown = create_async_constructor(async, timeout, fn);
            break;
            
          // An ordinary test. The test can be either sync or async. 
          default:
            fixture.tests.push({
              name: name,
              ctor: create_async_constructor(async, timeout, fn)
            });
            break;
        }
      }
    }
    return fixture;
  });
}

/**
 *  Runs a test suite
 */
function run_tests(suite, callback) {
  var case_results = [];

  // Entry point for the ´run_tests´ function. Run all test cases before calling
  // specified callback.
  function execute() {
    if (suite.length) {
      // Run next test case in queue.
      process.nextTick(next_case);
    } else {
      // We are done with all testing. Return test results to specified
      // callback.
      callback(case_results);
    }
  }

  // Runs next testcase. 
  function next_case() {
    var testcase    = suite.shift(),
        case_result = {
          name:       testcase.name,
          status:     'running',
          tests:      []
        };

    // Pushes the casetest results to testresults and call execute for 
    // more test cases.  
    function case_done() {

      if (case_result.status == 'running') {
        case_result.status = 'success';
      }
      
      show_fixture_result(case_result);
      
      case_results.push(case_result);
      
      process.nextTick(execute);
    }
    
    if (testcase.status == 'ignored') {
      // Ignore all modules that generated errors on import.
      case_result.status = 'ignored';
      case_result.reason = testcase.reason;
      case_done();
      return;
    }
    
    // Run next test in queue, or finish testcase
    function next_test() {
      var test = testcase.tests.shift();
      
      if (test) {
        var test_result = {
          name:   test.name,
          status: 'running',
          reason: null,
          start:  new Date(),
          end:    0,
        }
        
        // Execute the test
        test.ctor(function(r) {
          test_result.end = new Date();

          if (r.error || r.failure) {
            // Something in test went wrong
            test_result.status = r.error == null ? 'failure' : 'error';
            test_result.reason = r.error || r.failure;
          } else {
            test_result.status = 'success';
          }
          
          // Print a quick report on screen on failure
          if (test_result.status != 'success') {
            sys.puts(test_result.status + ' "' + 
                     testcase.name + '/' + 
                     test_result.name + '": ' + 
                     test_result.reason
            );
          }
          
          // Push report to case result.
          case_result.tests.push(test_result);
           
          // Run next test in queue
          process.nextTick(next_test);
        });
        
      } else {
        if (testcase.teardown) {
          // Call the teardown method before ending testcase.
          testcase.teardown(function(r) {
            if (r.error || r.failure) {
              // Teardown didn't go so well.
              case_result.status = 'teardown-failed';
              case_result.reason =  r.error || r.failure.message;
            } 

            // Test case is done. 
            case_done();
          });
        } else {
          // Test case is done. 
          case_done();
        }
      }
    }
    
    sys.puts('Running fixture "' + testcase.name + '", includes ' + testcase.tests.length + ' test(s)...');
    
    if (testcase.setup) {
      // Run setup before testing
      testcase.setup(function(r) {
        if (r.error || r.failure) {
          // Setup didn't go so well.
          case_result.status = 'setup-failed';
          case_result.reason = r.error || r.failure.message;
          case_done();
        }  else {
          // Test case is done. 
          process.nextTick(next_test);
        }
      });
    } else {
      // No setup required for test case. Start running tests.
      process.nextTick(next_test);
    }
  }

  // Start testing
  process.nextTick(execute);
}

/**
 *  Creates a async test handle constructor. The constructor is called by 
 *  the runner just before being used. 
 */
function create_async_constructor(async, timeout, fn) {
  return function(callback) {
    var result  = { failure: null, error: null };
    
    if (async) {
      // The fn is async. we need to add some async handlers to catch
      // exception and so on.
      var promise = new events.Promise();
      
      // A callback routine that should be called by the async function
      function ondone() {
        cleanup();
        callback(result);
      }

      // Catch all global uncaught exceptions. This is probably raised by the 
      // ´assert´ module. 
      function global_error_handle(err) {
        if (err.name == 'AssertionError') {
          result.failure = syncerr.message || syncerr.actual;
        } else {
          result.error = err.toString();
        }
        process.nextTick(ondone);
      }

      process.addListener('uncaughtException', global_error_handle);

      // Remove global error handle and kill promise. 
      function cleanup() {
        if (async) {
          promise.emitSuccess();
          process.removeListener('uncaughtException', global_error_handle);
        }
      }

      // Handle test timeout's
      promise.timeout(timeout);
      promise.addErrback(function(e) {
        if (e instanceof Error && e.message === "timeout") {
          result.failure = 'Timeout';
          ondone();
        } 
      });
      
      // Run the test as a `asynchronous` test. 
      fn(ondone);
    } else {
      
      // The fn is synchronous. We can go with a simple try/catch to find 
      // assertion errors.
      try {
        fn();
      } catch(syncerr) {
        if (syncerr.name == 'AssertionError') {
          result.failure = syncerr.message || syncerr.actual;
        } else {
          result.error = syncerr.toString();
        }
      } finally {
        process.nextTick(ondone);
      }
    }
  }
}

function show_fixture_result(fixture) {
  switch (fixture.status) {
    case 'setup-failed':
      sys.puts('Fixture setup failed and could therefor not be tested: ' + fixture.reason);
      break;
      
    case 'teardown-failed':
      sys.puts('Fixture teardown failed and could therefor not be tested: ' + fixture.reason);
      break;
      
    case 'ignored':
      sys.puts('Fixture was ignored, reason: ' + fixture.reason);
      break;
      
    default:
      var stats = get_fixture_stats(fixture);
      sys.puts(
        'Tests: ' + stats.tests + 
        ', Failures: ' +  stats.failures + 
        ', Errors: ' + stats.errors + 
        ', time: ' + (stats.time / 1000) + 's'
      );
      break;
  }
  sys.print('\n');
}

function show_result(result) {
  var total_time        = 0,
      total_fixtures    = result.length,
      total_tests       = 0,
      total_failures    = 0,
      total_errors      = 0,
      ignored_fixtures  = 0;

  result.forEach(function(fixture) {
    switch (fixture.status) {
      case 'setup-failed':
      case 'teardown-failed':
      case 'ignored':
        ignored_fixtures++;
        break;

      default:
        var stats = get_fixture_stats(fixture);
        total_tests += stats.tests;
        total_failures += stats.failures;
        total_errors += stats.errors;
        total_time += stats.time;
        break;
    }
  });

  sys.puts('--------------------------------------------------------------------------------');
  sys.puts('Fixtures: ' + total_fixtures + ' (ignored: ' + ignored_fixtures + ')');
  sys.puts('Tests: ' + total_tests + ' (failures: ' + total_failures + ', errors: ' + total_errors + ')');
  sys.puts('Time: ' + (total_time / 1000) + 's');
}

function get_fixture_stats(fixture) {
  var result = {
    tests:     0,
    failures:   0,
    errors:     0,
    time:       0
  };
  fixture.tests.forEach(function(test) {
    result.tests++;
    switch (test.status) {
      case 'failure':
        result.failures++;
        break;
      
      case 'error':
        result.errors++;
        break;
      
      default:
        result.time += test.end - test.start;
        break;
    }
  });
  return result;
}

function file_source(file_path) {
  return function(modules, callback) {
    posix.stat(file_path).addCallback(function(files) {
      var m = path.basename(file_path).match(RE_FILE_NAME);
      if (m) {
        var modname = path.basename(file_path, '.js');
        modules.push({ path: path.join(path.dirname(file_path), modname), name: m[1] });
      }
      callback(modules);
    }).addErrback(function(e) {
      callback(modules);
    });  
  }
}

function directory_source(dir_path) {
  return function(modules, callback) {
    posix.readdir(dir_path).addCallback(function(files) {
      files.forEach(function(file) {
        var m = file.match(RE_FILE_NAME);
        if (m) {
          var modname = path.basename(file, '.js');
          modules.push({ path: path.join(dir_path, modname), name: m[1] });
        }
      });
      callback(modules);
    }).addErrback(function() {
      callback(modules);
    });  
  }
}

main(process.ARGV.slice(2));