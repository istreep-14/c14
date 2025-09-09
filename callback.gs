/**
 * Callback data source for fetching additional game data from Chess.com's callback API
 * Uses game IDs extracted from existing game URLs to fetch enriched data
 */

/**
 * Extracts game ID from a chess.com game URL
 * @param {string} url - Game URL like https://www.chess.com/live/game/142266290868
 * @return {string} Game ID or empty string if not found
 */
function extractGameIdFromUrl_(url) {
  if (!url) return '';
  var match = String(url).match(/\/game\/(\d+)(?:\?.*)?$/);
  return match ? match[1] : '';
}

/**
 * Fetches game data from Chess.com callback API
 * @param {string} gameId - The game ID to fetch
 * @return {Object|null} Game data object or null if fetch failed
 */
function fetchCallbackData_(gameId) {
  if (!gameId) return null;
  
  var url = 'https://api.chess.com/pub/game/' + gameId;
  var options = {
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Chess.com Google Sheets Integration/2.0',
      'Accept-Encoding': 'gzip'
    }
  };
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    
    if (code === 200) {
      return JSON.parse(response.getContentText());
    } else if (code === 429) {
      // Rate limited - wait and retry once
      Utilities.sleep(2000);
      response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        return JSON.parse(response.getContentText());
      }
    }
  } catch (e) {
    console.error('Error fetching callback data for game ' + gameId + ': ' + e);
  }
  
  return null;
}

/**
 * Batch fetches callback data for multiple games
 * @param {Array<string>} gameIds - Array of game IDs
 * @param {number} batchSize - Number of games to process at once (default 5)
 * @return {Object} Map of gameId -> callback data
 */
function batchFetchCallbackData_(gameIds, batchSize) {
  batchSize = batchSize || 5;
  var results = {};
  
  for (var i = 0; i < gameIds.length; i += batchSize) {
    var batch = gameIds.slice(i, i + batchSize);
    
    // Process batch in parallel using UrlFetchApp.fetchAll
    var requests = batch.map(function(gameId) {
      return {
        url: 'https://api.chess.com/pub/game/' + gameId,
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Chess.com Google Sheets Integration/2.0',
          'Accept-Encoding': 'gzip'
        }
      };
    });
    
    try {
      var responses = UrlFetchApp.fetchAll(requests);
      
      responses.forEach(function(response, index) {
        var gameId = batch[index];
        if (response.getResponseCode() === 200) {
          try {
            results[gameId] = JSON.parse(response.getContentText());
          } catch (e) {
            console.error('Error parsing callback data for game ' + gameId);
          }
        }
      });
    } catch (e) {
      // Fallback to sequential if batch fails
      batch.forEach(function(gameId) {
        var data = fetchCallbackData_(gameId);
        if (data) results[gameId] = data;
      });
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < gameIds.length) {
      Utilities.sleep(1000);
    }
  }
  
  return results;
}

/**
 * Get all available callback fields from the API response
 * @return {Array<{field: string, description: string, example: *}>}
 */
function getCallbackFields_() {
  // These are the additional fields available from the callback API
  // that may not be present in the monthly archives API
  return [
    // Game metadata
    { field: 'game_id', description: 'Unique game identifier', example: '142266290868' },
    { field: 'tournament', description: 'Tournament URL if applicable', example: 'https://www.chess.com/tournament/...' },
    { field: 'match', description: 'Match URL if applicable', example: 'https://www.chess.com/match/...' },
    
    // Extended player data
    { field: 'white.country', description: 'White player country code', example: 'US' },
    { field: 'black.country', description: 'Black player country code', example: 'GB' },
    { field: 'white.title', description: 'White player title (GM, IM, etc)', example: 'GM' },
    { field: 'black.title', description: 'Black player title', example: 'IM' },
    { field: 'white.fide', description: 'White player FIDE rating', example: 2700 },
    { field: 'black.fide', description: 'Black player FIDE rating', example: 2650 },
    
    // Extended game data
    { field: 'eco_name', description: 'Opening name from ECO', example: 'Sicilian Defense' },
    { field: 'opening_ply', description: 'Number of plies in the opening', example: 12 },
    { field: 'time_control_initial', description: 'Initial time in seconds', example: 300 },
    { field: 'time_control_increment', description: 'Increment in seconds', example: 0 },
    
    // Analysis data (if available)
    { field: 'analysis_url', description: 'URL to game analysis', example: 'https://www.chess.com/analysis/...' },
    { field: 'white.accuracy', description: 'White accuracy percentage', example: 92.5 },
    { field: 'black.accuracy', description: 'Black accuracy percentage', example: 87.3 },
    { field: 'white.mistakes', description: 'Number of mistakes by white', example: 2 },
    { field: 'black.mistakes', description: 'Number of mistakes by black', example: 3 },
    { field: 'white.blunders', description: 'Number of blunders by white', example: 0 },
    { field: 'black.blunders', description: 'Number of blunders by black', example: 1 },
    
    // Timing data
    { field: 'start_time', description: 'Game start timestamp', example: 1234567890 },
    { field: 'time_per_move', description: 'Average time per move in seconds', example: 15.2 },
    
    // Additional metadata
    { field: 'rated_mode', description: 'Rating mode (rated/unrated)', example: 'rated' },
    { field: 'rules_variant', description: 'Chess variant details', example: 'standard' },
    { field: 'initial_fen', description: 'Starting position FEN', example: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    { field: 'current_fen', description: 'Current/final position FEN', example: '8/8/8/8/8/8/8/8 w - - 0 1' },
    
    // PGN extensions
    { field: 'pgn_headers', description: 'All PGN headers as JSON', example: '{"Event":"Live Chess","Site":"Chess.com",...}' },
    { field: 'moves_timed', description: 'Moves with timestamps', example: '[{"move":"e4","time":298},...]' },
    { field: 'evaluation_graph', description: 'Evaluation data points', example: '[0.3, 0.5, -0.2, ...]' }
  ];
}

/**
 * Process callback data into row values based on selected headers
 * @param {Object} callbackData - Data from callback API
 * @param {string} gameId - Game ID
 * @param {Array} selectedHeaders - Selected headers with callback source
 * @return {Array} Row values for the callback columns
 */
function processCallbackData_(callbackData, gameId, selectedHeaders) {
  if (!callbackData) return selectedHeaders.map(function() { return ''; });
  
  return selectedHeaders.map(function(header) {
    if (header.source !== 'callback') return '';
    
    var field = header.field;
    
    // Special handling for game_id
    if (field === 'game_id') return gameId;
    
    // Special handling for complex fields
    if (field === 'pgn_headers' && callbackData.pgn) {
      try {
        var headers = {};
        var headerMatches = String(callbackData.pgn).match(/^\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/gm);
        if (headerMatches) {
          headerMatches.forEach(function(match) {
            var parts = match.match(/^\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/);
            if (parts) headers[parts[1]] = parts[2];
          });
        }
        return JSON.stringify(headers);
      } catch (e) {
        return '';
      }
    }
    
    // Special handling for derived fields
    if (field === 'time_control_initial' && callbackData.time_control) {
      var tc = parseTimeControlString_(callbackData.time_control);
      return tc.initialSec || '';
    }
    
    if (field === 'time_control_increment' && callbackData.time_control) {
      var tc = parseTimeControlString_(callbackData.time_control);
      return tc.incrementSec || '';
    }
    
    // Use standard deep get for nested fields
    return deepGet_(callbackData, field);
  });
}

/**
 * Helper to parse time control strings
 * @private
 */
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

/**
 * Shows a dialog for batch processing callback data
 */
function showCallbackBatchDialog() {
  var ui = SpreadsheetApp.getUi();
  var html = HtmlService.createHtmlOutput(getCallbackBatchDialogHtml_())
    .setWidth(600)
    .setHeight(500)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  ui.showModalDialog(html, 'Batch Process Callback Data');
}

/**
 * Gets the HTML for the callback batch dialog
 * @private
 */
function getCallbackBatchDialogHtml_() {
  return `
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      .container { max-width: 550px; }
      h3 { margin-top: 0; }
      .instructions { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
      .input-group { margin-bottom: 20px; }
      label { display: block; margin-bottom: 5px; font-weight: bold; }
      textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; }
      input[type="number"] { width: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
      .checkbox-group { margin: 15px 0; }
      .buttons { margin-top: 20px; }
      button { padding: 10px 20px; margin-right: 10px; border: none; border-radius: 4px; cursor: pointer; }
      .primary { background: #4285f4; color: white; }
      .secondary { background: #f1f3f4; color: #202124; }
      button:hover { opacity: 0.9; }
      .progress { display: none; margin-top: 20px; }
      .progress-bar { background: #e0e0e0; height: 20px; border-radius: 10px; overflow: hidden; }
      .progress-fill { background: #4285f4; height: 100%; width: 0%; transition: width 0.3s; }
      .status { margin-top: 10px; color: #666; }
      .error { color: #d93025; margin-top: 10px; }
      .success { color: #188038; margin-top: 10px; }
    </style>
  </head>
  <body>
    <div class="container">
      <h3>Batch Process Callback Data</h3>
      
      <div class="instructions">
        <p><strong>Instructions:</strong></p>
        <p>1. Enter Chess.com game URLs (one per line)</p>
        <p>2. Or enter just the game IDs</p>
        <p>3. Click "Process" to fetch additional data from Chess.com</p>
        <p>Example URLs:</p>
        <code>https://www.chess.com/live/game/142266290868<br>
        https://www.chess.com/game/live/142266290869<br>
        142266290870</code>
      </div>
      
      <div class="input-group">
        <label for="gameInput">Game URLs or IDs:</label>
        <textarea id="gameInput" rows="8" placeholder="Enter game URLs or IDs, one per line..."></textarea>
      </div>
      
      <div class="input-group">
        <label for="batchSize">Batch Size (games to process at once):</label>
        <input type="number" id="batchSize" value="5" min="1" max="20">
      </div>
      
      <div class="checkbox-group">
        <label>
          <input type="checkbox" id="updateExisting" checked>
          Update existing callback data
        </label>
      </div>
      
      <div class="buttons">
        <button class="primary" onclick="processGames()">Process Games</button>
        <button class="secondary" onclick="google.script.host.close()">Cancel</button>
      </div>
      
      <div class="progress" id="progress">
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
        <div class="status" id="status"></div>
      </div>
      
      <div class="error" id="error"></div>
      <div class="success" id="success"></div>
    </div>
    
    <script>
      function processGames() {
        const input = document.getElementById('gameInput').value.trim();
        const batchSize = parseInt(document.getElementById('batchSize').value) || 5;
        const updateExisting = document.getElementById('updateExisting').checked;
        
        if (!input) {
          showError('Please enter at least one game URL or ID');
          return;
        }
        
        // Extract game IDs from input
        const lines = input.split('\\n');
        const gameIds = [];
        
        lines.forEach(line => {
          line = line.trim();
          if (!line) return;
          
          // Check if it's already just a game ID
          if (/^\\d+$/.test(line)) {
            gameIds.push(line);
          } else {
            // Try to extract from URL
            const match = line.match(/\\/game\\/(\\d+)/);
            if (match) {
              gameIds.push(match[1]);
            }
          }
        });
        
        if (gameIds.length === 0) {
          showError('No valid game IDs found in input');
          return;
        }
        
        // Disable buttons and show progress
        document.querySelector('.primary').disabled = true;
        document.querySelector('.secondary').disabled = true;
        document.getElementById('progress').style.display = 'block';
        document.getElementById('error').textContent = '';
        document.getElementById('success').textContent = '';
        
        updateStatus('Processing ' + gameIds.length + ' games...');
        
        // Call server function
        google.script.run
          .withSuccessHandler(onSuccess)
          .withFailureHandler(onFailure)
          .processBatchCallbackData(gameIds, batchSize, updateExisting);
      }
      
      function updateStatus(message) {
        document.getElementById('status').textContent = message;
      }
      
      function updateProgress(percent) {
        document.getElementById('progressFill').style.width = percent + '%';
      }
      
      function showError(message) {
        document.getElementById('error').textContent = message;
      }
      
      function onSuccess(result) {
        document.getElementById('success').textContent = result;
        updateProgress(100);
        updateStatus('Complete!');
        
        // Re-enable buttons
        document.querySelector('.primary').disabled = false;
        document.querySelector('.secondary').disabled = false;
      }
      
      function onFailure(error) {
        showError('Error: ' + error.message);
        
        // Re-enable buttons
        document.querySelector('.primary').disabled = false;
        document.querySelector('.secondary').disabled = false;
        
        // Hide progress
        document.getElementById('progress').style.display = 'none';
      }
    </script>
  </body>
</html>
  `;
}

/**
 * Process batch callback data from the dialog
 * @param {Array<string>} gameIds - Array of game IDs to process
 * @param {number} batchSize - Batch size for processing
 * @param {boolean} updateExisting - Whether to update existing data
 * @return {string} Success message
 */
function processBatchCallbackData(gameIds, batchSize, updateExisting) {
  var headersSheet = getOrCreateSheet_(SHEET_HEADERS_NAME);
  var gamesSheet = getOrCreateSheet_(SHEET_GAMES_NAME);
  var selectedHeaders = readSelectedHeaders_(headersSheet);
  
  // Check if any callback headers are selected
  var hasCallbackHeaders = selectedHeaders.some(function(h) { return h.source === 'callback'; });
  if (!hasCallbackHeaders) {
    throw new Error('No callback headers are enabled. Please enable at least one callback field in the Headers sheet.');
  }
  
  // Find URL column index
  var urlIndex = selectedHeaders.findIndex(function(h) { return h.source === 'json' && h.field === 'url'; });
  if (urlIndex === -1) {
    throw new Error('The "url" field must be enabled in Headers to process callback data.');
  }
  
  // Fetch callback data
  var callbackData = batchFetchCallbackData_(gameIds, batchSize);
  
  // Find existing rows and add new ones
  var lastRow = gamesSheet.getLastRow();
  var lastCol = gamesSheet.getLastColumn();
  var processedCount = 0;
  var newRowsAdded = 0;
  
  if (lastRow >= 2) {
    // Update existing rows
    var values = gamesSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var updated = false;
    
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var url = String(row[urlIndex] || '').trim();
      if (!url) continue;
      
      var gameId = extractGameIdFromUrl_(url);
      if (!gameId || !callbackData[gameId]) continue;
      
      // Process callback data for this row
      var data = callbackData[gameId];
      var callbackValues = processCallbackData_(data, gameId, selectedHeaders);
      
      // Update callback columns
      var changed = false;
      for (var c = 0; c < selectedHeaders.length; c++) {
        if (selectedHeaders[c].source === 'callback') {
          if (!row[c] || updateExisting) {
            row[c] = callbackValues[c];
            changed = true;
          }
        }
      }
      
      if (changed) {
        values[r] = row;
        updated = true;
        processedCount++;
      }
    }
    
    if (updated) {
      gamesSheet.getRange(2, 1, values.length, lastCol).setValues(values);
    }
  }
  
  // Add new rows for game IDs not found in sheet
  var existingGameIds = new Set();
  if (lastRow >= 2) {
    var urls = gamesSheet.getRange(2, urlIndex + 1, lastRow - 1, 1).getValues();
    urls.forEach(function(row) {
      var gameId = extractGameIdFromUrl_(String(row[0] || ''));
      if (gameId) existingGameIds.add(gameId);
    });
  }
  
  var newRows = [];
  gameIds.forEach(function(gameId) {
    if (!existingGameIds.has(gameId) && callbackData[gameId]) {
      var data = callbackData[gameId];
      var row = selectedHeaders.map(function(h) {
        if (h.source === 'callback') {
          return processCallbackData_(data, gameId, selectedHeaders)[selectedHeaders.indexOf(h)];
        } else if (h.source === 'json' && h.field === 'url' && data.url) {
          return data.url;
        }
        return '';
      });
      newRows.push(row);
      newRowsAdded++;
    }
  });
  
  if (newRows.length > 0) {
    var startRow = gamesSheet.getLastRow() + 1;
    gamesSheet.getRange(startRow, 1, newRows.length, selectedHeaders.length).setValues(newRows);
  }
  
  return 'Successfully processed ' + (processedCount + newRowsAdded) + ' games. ' +
         'Updated: ' + processedCount + ', Added: ' + newRowsAdded;
}