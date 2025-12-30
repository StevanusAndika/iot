// src/worker.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    console.log(`[${new Date().toISOString()}] ${method} ${path}`);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // Authentication check - DISABLED untuk testing
    // const authHeader = request.headers.get('Authorization');
    // if (!authHeader || !authHeader.startsWith('Bearer ')) {
    //   return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    //     status: 401,
    //     headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    //   });
    // }

    // const token = authHeader.replace('Bearer ', '');
    // const expectedToken = env.API_TOKEN || 'face-recognition-token-123';
    
    // if (token !== expectedToken) {
    //   return new Response(JSON.stringify({ error: 'Invalid token' }), {
    //     status: 401,
    //     headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    //   });
    // }

    try {
      // ===== HEALTH CHECK =====
      if (path === '/health' && method === 'GET') {
        return new Response(JSON.stringify({ 
          status: 'ok', 
          message: 'Face Recognition API is running',
          timestamp: new Date().toISOString(),
          endpoints: ['/health', '/data', '/data/clear']
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ===== GET ALL FACES =====
      if (path === '/data' && method === 'GET') {
        try {
          console.log('Fetching all faces from database...');
          
          // Cek apakah tabel faces ada
          const tableCheck = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='faces'"
          ).first();
          
          // Jika tabel tidak ada, return array kosong
          if (!tableCheck) {
            console.log('Table faces does not exist, returning empty array');
            return new Response(JSON.stringify([]), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          // Ambil semua data dari tabel faces
          const { results } = await env.DB.prepare(
            'SELECT id, name, vector, created_at FROM faces ORDER BY created_at DESC'
          ).all();

          console.log(`Found ${results?.length || 0} faces`);
          
          return new Response(JSON.stringify(results || []), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (dbError) {
          console.error('Database error:', dbError);
          return new Response(JSON.stringify({ 
            error: 'Database error',
            details: dbError.message,
            note: 'Table might not exist yet'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== ADD NEW FACE =====
      if (path === '/data' && method === 'POST') {
        try {
          const data = await request.json();
          const { name, vec } = data;

          if (!name || !vec || !Array.isArray(vec)) {
            return new Response(JSON.stringify({ 
              error: 'Invalid data format',
              required: { name: 'string', vec: 'array' },
              received: { name: typeof name, vec: Array.isArray(vec) ? 'array' : typeof vec }
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          console.log(`Adding face: ${name}, vector length: ${vec.length}`);
          
          const result = await env.DB.prepare(
            'INSERT INTO faces (name, vector) VALUES (?, ?)'
          ).bind(name, JSON.stringify(vec)).run();

          return new Response(JSON.stringify({ 
            id: result.meta.last_row_id,
            name,
            message: 'Face added successfully'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Error adding face:', error);
          return new Response(JSON.stringify({ 
            error: 'Failed to add face',
            details: error.message 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== CLEAR ALL FACES =====
      if (path === '/data/clear' && method === 'DELETE') {
        try {
          console.log('Clearing all faces...');
          
          // Cek apakah tabel ada sebelum menghapus
          const tableCheck = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='faces'"
          ).first();
          
          if (!tableCheck) {
            console.log('Table faces does not exist, nothing to clear');
            return new Response(JSON.stringify({ 
              message: 'Table does not exist, nothing to clear'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          await env.DB.prepare('DELETE FROM faces').run();
          
          console.log('All faces cleared successfully');
          return new Response(JSON.stringify({ 
            message: 'All faces cleared successfully'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Error clearing faces:', error);
          return new Response(JSON.stringify({ 
            error: 'Failed to clear faces',
            details: error.message 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== GET SINGLE FACE BY ID =====
      if (path.startsWith('/data/') && path.split('/').length === 3 && method === 'GET') {
        try {
          const id = path.split('/')[2];
          
          if (!id || isNaN(id)) {
            return new Response(JSON.stringify({ error: 'Invalid ID format' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          const result = await env.DB.prepare(
            'SELECT id, name, vector, created_at FROM faces WHERE id = ?'
          ).bind(id).first();

          if (!result) {
            return new Response(JSON.stringify({ 
              error: 'Face not found',
              id: id 
            }), {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Error getting face by ID:', error);
          return new Response(JSON.stringify({ 
            error: 'Failed to get face',
            details: error.message 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== DELETE FACE BY ID =====
      if (path.startsWith('/data/') && path.split('/').length === 3 && method === 'DELETE') {
        try {
          const id = path.split('/')[2];
          
          if (!id || isNaN(id)) {
            return new Response(JSON.stringify({ error: 'Invalid ID format' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          const result = await env.DB.prepare(
            'DELETE FROM faces WHERE id = ?'
          ).bind(id).run();

          return new Response(JSON.stringify({ 
            message: 'Face deleted successfully',
            id: id,
            deleted: true
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Error deleting face:', error);
          return new Response(JSON.stringify({ 
            error: 'Failed to delete face',
            details: error.message 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== TEST ENDPOINT FOR TABLE CREATION =====
      if (path === '/init' && method === 'GET') {
        try {
          console.log('Initializing database...');
          
          // Buat tabel jika belum ada
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS faces (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              vector TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `).run();
          
          // Buat index jika belum ada
          await env.DB.prepare(`
            CREATE INDEX IF NOT EXISTS idx_name ON faces(name)
          `).run();
          
          return new Response(JSON.stringify({ 
            message: 'Database initialized successfully',
            table: 'faces created',
            index: 'idx_name created'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Error initializing database:', error);
          return new Response(JSON.stringify({ 
            error: 'Failed to initialize database',
            details: error.message 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== LIST ALL TABLES (DEBUG) =====
      if (path === '/debug/tables' && method === 'GET') {
        try {
          const { results } = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type='table'"
          ).all();
          
          return new Response(JSON.stringify(results), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Error listing tables:', error);
          return new Response(JSON.stringify({ 
            error: 'Failed to list tables',
            details: error.message 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== 404 NOT FOUND =====
      return new Response(JSON.stringify({ 
        error: 'Not found',
        path: path,
        method: method,
        available_endpoints: [
          'GET /health',
          'GET /data',
          'POST /data',
          'DELETE /data/clear',
          'GET /data/:id',
          'DELETE /data/:id',
          'GET /init',
          'GET /debug/tables'
        ]
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Unhandled error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};