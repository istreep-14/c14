function getDerivedRegistry_() {
  // Helper to parse time control strings like "300+0", "600+5", or "600"
  function parseTimeControlString_(tc) {
    var s = String(tc || '').trim();
    if (!s || s === '-') return { initialSec: null, incrementSec: null };
    var parts = s.split('+');
    var initialSec = parseInt(parts[0], 10);
    var incrementSec = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (!isFinite(initialSec)) initialSec = null;
    if (!isFinite(incrementSec)) incrementSec = null;
    return { initialSec: initialSec, incrementSec: incrementSec };
  }

  function classifySpeed_(initialSec, incrementSec) {
    if (initialSec === '' || initialSec == null) return '';
    var inc = incrementSec || 0;
    var base = Number(initialSec) + Number(inc) * 40;
    if (base < 180) return 'bullet';
    if (base < 480) return 'blitz';
    if (base < 1500) return 'rapid';
    return 'classical';
  }

  // Compute functions
  var registry = {
    result_numeric: {
      displayName: 'Result (Numeric)',
      description: '1 (white win), 0.5 (draw), 0 (black win) from PGN Result',
      example: 1,
      compute: function(game, pgnTags, pgnMoves) {
        var r = String((pgnTags && pgnTags['Result']) || '').trim();
        if (r === '1-0') return 1;
        if (r === '0-1') return 0;
        if (r === '1/2-1/2') return 0.5;
        return '';
      }
    },
    moves_count: {
      displayName: 'Moves (count)',
      description: 'Approximate number of full moves in PGN',
      example: 32,
      compute: function(game, pgnTags, pgnMoves) {
        var text = String(pgnMoves || '');
        if (!text) return '';
        var matches = text.match(/\b\d+\./g);
        return matches ? matches.length : '';
      }
    },
    plies: {
      displayName: 'Plies',
      description: 'Approximate number of half-moves (plies)',
      example: 64,
      compute: function(game, pgnTags, pgnMoves) {
        var moves = registry.moves_count.compute(game, pgnTags, pgnMoves);
        if (moves === '' || moves == null) return '';
        // Roughly two plies per move (may be off by 1 for unfinished last move)
        return Number(moves) * 2;
      }
    },
    initial_seconds: {
      displayName: 'InitialSec',
      description: 'Initial time (seconds) parsed from time control',
      example: 300,
      compute: function(game, pgnTags, pgnMoves) {
        var tc = (game && game.time_control) || (pgnTags && pgnTags['TimeControl']) || '';
        return parseTimeControlString_(tc).initialSec;
      }
    },
    increment_seconds: {
      displayName: 'Increment',
      description: 'Increment (seconds) parsed from time control',
      example: 0,
      compute: function(game, pgnTags, pgnMoves) {
        var tc = (game && game.time_control) || (pgnTags && pgnTags['TimeControl']) || '';
        return parseTimeControlString_(tc).incrementSec;
      }
    },
    speed_class: {
      displayName: 'SpeedClass',
      description: 'bullet / blitz / rapid / classical derived from time control',
      example: 'blitz',
      compute: function(game, pgnTags, pgnMoves) {
        var tc = (game && game.time_control) || (pgnTags && pgnTags['TimeControl']) || '';
        var parsed = parseTimeControlString_(tc);
        return classifySpeed_(parsed.initialSec, parsed.incrementSec);
      }
    },
    accuracy_diff: {
      displayName: 'AccuracyDiff',
      description: 'WhiteAccuracy - BlackAccuracy from PGN tags (if present)',
      example: 3.2,
      compute: function(game, pgnTags, pgnMoves) {
        var w = parseFloat((pgnTags && pgnTags['WhiteAccuracy']) || '');
        var b = parseFloat((pgnTags && pgnTags['BlackAccuracy']) || '');
        if (!isFinite(w) || !isFinite(b)) return '';
        // Keep one decimal like Chess.com UI typically shows
        return Math.round((w - b) * 10) / 10;
      }
    }
  };

  // -------- Additional helpers for new derived fields --------
  function formatLocalDateTime_(dateObj) {
    try {
      var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
      return Utilities.formatDate(dateObj, tz || 'UTC', 'yyyy-MM-dd HH:mm:ss');
    } catch (e) {
      return '';
    }
  }

  function epochSecToDate_(epochSec) {
    if (epochSec == null || epochSec === '' || !isFinite(Number(epochSec))) return null;
    try { return new Date(Number(epochSec) * 1000); } catch (e) { return null; }
  }

  function parseHmsToSeconds_(s) {
    var t = String(s || '').trim();
    if (!t) return null;
    // Support fractional seconds like 0:02:59.9
    var rawParts = t.split(':');
    if (rawParts.length < 2) {
      var nOnly = parseFloat(t);
      return isFinite(nOnly) ? nOnly : null;
    }
    var secondsPart = rawParts.pop();
    var minutesPart = rawParts.pop();
    var hoursPart = rawParts.length > 0 ? rawParts.pop() : '0';
    var seconds = parseFloat(String(secondsPart).replace(/[^0-9\.]/g, ''));
    var minutes = parseInt(minutesPart, 10);
    var hours = parseInt(hoursPart, 10);
    if (!isFinite(seconds) || !isFinite(minutes) || !isFinite(hours)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function computeGameLengthSecondsFromPgn_(pgnTags) {
    if (!pgnTags) return '';
    var start = parseHmsToSeconds_(pgnTags['StartTime']);
    var end = parseHmsToSeconds_(pgnTags['EndTime']);
    if (start == null || end == null) return '';
    var diff = end - start;
    if (diff < 0) diff += 24 * 3600; // handle midnight rollover
    return diff;
  }

  function extractClocksFromPgn_(pgnText) {
    var re = /\[%clk\s+([^\]]+)\]/g;
    var clocks = [];
    if (!pgnText) return clocks;
    var m;
    while ((m = re.exec(String(pgnText))) !== null) {
      clocks.push(m[1]);
    }
    return clocks;
  }

  function clocksToSecondsList_(clocks) {
    if (!clocks || !clocks.length) return [];
    return clocks.map(function(c){
      var n = parseHmsToSeconds_(c);
      return (typeof n === 'number' && isFinite(n)) ? n : null;
    });
  }

  // --- SAN moves helpers ---
  function stripCurlyComments_(s) {
    return String(s || '').replace(/\{[^}]*\}/g, ' ');
  }

  function stripSemicolonComments_(s) {
    return String(s || '').replace(/;[^\n]*/g, '');
  }

  function stripNagAnnotations_(s) {
    return String(s || '').replace(/\$\d+/g, '');
  }

  function removeMoveNumbers_(s) {
    return String(s || '').replace(/\b\d+\.(?:\.\.)?/g, ' ');
  }

  function normalizeWhitespace_(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function extractSanPliesFromMoves_(movesText) {
    var t = String(movesText || '');
    if (!t) return [];
    // Remove comments and annotations
    t = stripCurlyComments_(t);
    t = stripSemicolonComments_(t);
    t = stripNagAnnotations_(t);
    // Remove move numbers and results
    t = removeMoveNumbers_(t);
    t = t.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ');
    // Normalize and split
    t = normalizeWhitespace_(t);
    if (!t) return [];
    var tokens = t.split(' ');
    // Filter ellipses and empties
    tokens = tokens.filter(function(tok) { return tok && tok !== '...' && tok !== '..'; });
    return tokens;
  }

  function stripBracketTags_(s) {
    return String(s || '').replace(/\[%[^\]]*\]/g, ' ');
  }

  function normalizeNumberedMovesText_(movesText) {
    var t = String(movesText || '');
    if (!t) return '';
    t = stripCurlyComments_(t);
    t = stripSemicolonComments_(t);
    t = stripNagAnnotations_(t);
    t = stripBracketTags_(t); // remove [%clk], [%eval], etc.
    // Remove result tokens
    t = t.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ');
    // Normalize  "1..." to "1." style
    t = t.replace(/\b(\d+)\.\.\./g, '$1.');
    // Collapse whitespace
    t = normalizeWhitespace_(t);
    return t;
  }

  function buildMoveDurations_(clockSecondsList, baseSec, incSec) {
    if (!clockSecondsList || !clockSecondsList.length) return [];
    var can = (baseSec != null && incSec != null && isFinite(baseSec) && isFinite(incSec));
    if (!can) return [];
    // Split by side: even indexes are white (0-based), odd are black
    var white = [];
    var black = [];
    for (var i = 0; i < clockSecondsList.length; i++) {
      var v = clockSecondsList[i];
      if (typeof v !== 'number' || !isFinite(v)) { if (i % 2 === 0) white.push(null); else black.push(null); continue; }
      if (i % 2 === 0) white.push(v); else black.push(v);
    }
    function durationsFor(seq) {
      var out = [];
      for (var i = 0; i < seq.length; i++) {
        var curr = seq[i];
        if (typeof curr !== 'number' || !isFinite(curr)) { out.push(''); continue; }
        if (i === 0) {
          var d0 = Math.max(0, baseSec - curr + incSec);
          out.push(Math.round(d0 * 100) / 100);
        } else {
          var prev = seq[i-1];
          if (typeof prev !== 'number' || !isFinite(prev)) { out.push(''); continue; }
          var di = Math.max(0, prev - curr + incSec);
          out.push(Math.round(di * 100) / 100);
        }
      }
      return out;
    }
    var wDur = durationsFor(white);
    var bDur = durationsFor(black);
    var merged = [];
    var maxLen = Math.max(wDur.length, bDur.length);
    for (var k = 0; k < maxLen; k++) {
      if (k < wDur.length) merged.push(wDur[k]);
      if (k < bDur.length) merged.push(bDur[k]);
    }
    return merged;
  }

  function listToBracedString_(arr) {
    if (!arr || !arr.length) return '';
    return '{' + arr.map(function(x){ return (x === '' || x == null) ? '' : String(x); }).join(', ') + '}';
  }

  // -------- New derived entries --------
  registry.base_seconds = {
    displayName: 'Base time (s)',
    description: 'Initial time (seconds) parsed from time control',
    example: 300,
    compute: function(game, pgnTags, pgnMoves) {
      var tc = (game && game.time_control) || (pgnTags && pgnTags['TimeControl']) || '';
      return parseTimeControlString_(tc).initialSec;
    }
  };

  registry.increment_seconds.displayName = 'Increment (s)';

  registry.end_time_formatted = {
    displayName: 'End Time (Local)',
    description: 'Game end time formatted in spreadsheet time zone',
    example: '2025-09-08 14:23:45',
    compute: function(game) {
      var d = epochSecToDate_(game && game.end_time);
      return d ? formatLocalDateTime_(d) : '';
    }
  };

  registry.end_year = { displayName: 'End Year', description: 'YYYY from end_time', example: 2025, compute: function(game){ var d = epochSecToDate_(game && game.end_time); return d ? d.getFullYear() : ''; } };
  registry.end_month = { displayName: 'End Month', description: '1-12 from end_time', example: 9, compute: function(game){ var d = epochSecToDate_(game && game.end_time); return d ? (d.getMonth()+1) : ''; } };
  registry.end_day = { displayName: 'End Day', description: '1-31 from end_time', example: 8, compute: function(game){ var d = epochSecToDate_(game && game.end_time); return d ? d.getDate() : ''; } };
  registry.end_hour = { displayName: 'End Hour', description: '0-23 from end_time', example: 14, compute: function(game){ var d = epochSecToDate_(game && game.end_time); return d ? d.getHours() : ''; } };
  registry.end_minute = { displayName: 'End Minute', description: '0-59 from end_time', example: 23, compute: function(game){ var d = epochSecToDate_(game && game.end_time); return d ? d.getMinutes() : ''; } };
  registry.end_second = { displayName: 'End Second', description: '0-59 from end_time', example: 45, compute: function(game){ var d = epochSecToDate_(game && game.end_time); return d ? d.getSeconds() : ''; } };
  registry.end_millisecond = { displayName: 'End Milliseconds', description: '0-999 from end_time', example: 123, compute: function(game){ var d = epochSecToDate_(game && game.end_time); return d ? d.getMilliseconds() : ''; } };

  registry.game_length_seconds = {
    displayName: 'GameLength (s)',
    description: 'Derived from PGN tags EndTime - StartTime',
    example: 420,
    compute: function(game, pgnTags) { return computeGameLengthSecondsFromPgn_(pgnTags); }
  };

  registry.start_time_derived_local = {
    displayName: 'Start Time (Local, derived)',
    description: 'End Time minus GameLength (local time zone)',
    example: '2025-09-08 14:16:45',
    compute: function(game, pgnTags) {
      var d = epochSecToDate_(game && game.end_time);
      var len = computeGameLengthSecondsFromPgn_(pgnTags);
      if (!d || !isFinite(len)) return '';
      return formatLocalDateTime_(new Date(d.getTime() - Number(len) * 1000));
    }
  };

  registry.moves_san_list = {
    displayName: 'Moves (SAN list)',
    description: 'List of SAN plies (no comments/clock/NAG/move numbers)',
    example: '{e4, e5, Nf3, Nc6, ...}',
    compute: function(game, pgnTags, pgnMoves) {
      var plies = extractSanPliesFromMoves_(pgnMoves);
      return listToBracedString_(plies);
    }
  };

  registry.moves_list_numbered = {
    displayName: 'Moves (numbered)',
    description: 'Numbered SAN movetext (comments/NAG/clock tags removed)',
    example: '1. e4 e5 2. Nf3 Nc6',
    compute: function(game, pgnTags, pgnMoves) {
      return normalizeNumberedMovesText_(pgnMoves);
    }
  };

  registry.clocks_list = {
    displayName: 'Clocks',
    description: 'Clock tags extracted from PGN, in original format',
    example: '{5:00, 5:00, 4:58, ...}',
    compute: function(game, pgnTags, pgnMoves) {
      var pgn = (pgnMoves && String(pgnMoves)) || (game && game.pgn) || '';
      var clocks = extractClocksFromPgn_(pgn);
      return listToBracedString_(clocks);
    }
  };

  registry.clock_seconds_list = {
    displayName: 'Clock Seconds',
    description: 'Clock tags converted to seconds',
    example: '{300, 300, 298, ...}',
    compute: function(game, pgnTags, pgnMoves) {
      var pgn = (pgnMoves && String(pgnMoves)) || (game && game.pgn) || '';
      var clocks = extractClocksFromPgn_(pgn);
      var secs = clocksToSecondsList_(clocks);
      return listToBracedString_(secs);
    }
  };

  registry.move_times_seconds = {
    displayName: 'Clock Seconds_Incriment',
    description: 'Per-ply durations including increment (legacy label)',
    example: '{2, 2, 3, ...}',
    compute: function(game, pgnTags, pgnMoves) {
      var pgn = (pgnMoves && String(pgnMoves)) || (game && game.pgn) || '';
      var clocks = extractClocksFromPgn_(pgn);
      var secs = clocksToSecondsList_(clocks);
      var tc = (game && game.time_control) || (pgnTags && pgnTags['TimeControl']) || '';
      var parsed = parseTimeControlString_(tc);
      var durations = buildMoveDurations_(secs, parsed.initialSec, parsed.incrementSec);
      return listToBracedString_(durations);
    }
  };

  registry.reason = {
    displayName: 'Reason',
    description: 'Termination reason from PGN tag',
    example: 'Time forfeit',
    compute: function(game, pgnTags) { return (pgnTags && pgnTags['Termination']) || ''; }
  };

  registry.format = {
    displayName: 'Format',
    description: 'Format derived from rules/time_class (e.g., blitz, rapid, live960, daily 960)',
    example: 'blitz',
    compute: function(game, pgnTags) {
      var rules = (game && game.rules) || '';
      var timeClass = (game && game.time_class) || '';
      if (rules === 'chess') return timeClass || '';
      if (rules === 'chess960') return (timeClass === 'daily') ? 'daily 960' : 'live960';
      return rules || '';
    }
  };

  registry.opening_url = {
    displayName: 'Opening URL',
    description: 'From PGN ECOUrl/OpeningUrl or JSON opening_url',
    example: 'https://www.chess.com/openings/...',
    compute: function(game, pgnTags) {
      var v = (pgnTags && (pgnTags['ECOUrl'] || pgnTags['OpeningUrl'])) || (game && game.opening_url) || '';
      return v || '';
    }
  };

  registry.endboard_url = {
    displayName: 'Endboard URL',
    description: 'Image URL for final FEN (service-dependent)',
    example: 'https://www.chess.com/dynboard?fen=...'
    ,compute: function(game) {
      var fen = (game && game.fen) || '';
      if (!fen) return '';
      // Generic fallback compatible with chess.com dynamic board
      return 'https://www.chess.com/dynboard?fen=' + encodeURIComponent(String(fen));
    }
  };

  registry.rating_difference = {
    displayName: 'RatingDiff (opp - mine)',
    description: 'Black rating minus White rating (no player context in V2)',
    example: 35,
    compute: function(game) {
      var w = game && game.white && game.white.rating;
      var b = game && game.black && game.black.rating;
      if (!isFinite(w) || !isFinite(b)) return '';
      return Number(b) - Number(w);
    }
  };

  return registry;
}
