// src/worker.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // Authentication check
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    // You can add token validation logic here
    // For now, we'll accept any token

    try {
      // Health check endpoint
      if (path === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({ 
          status: 'ok', 
          message: 'Face Recognition API is running',
          timestamp: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get all faces
      if (path === '/data' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, name, vector, created_at FROM faces ORDER BY created_at DESC'
        ).all();

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Add new face
      if (path === '/data' && request.method === 'POST') {
        const data = await request.json();
        const { name, vec } = data;

        if (!name || !vec || !Array.isArray(vec)) {
          return new Response(JSON.stringify({ error: 'Invalid data format' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

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
      }

      // Clear all faces
      if (path === '/data/clear' && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM faces').run();
        
        return new Response(JSON.stringify({ 
          message: 'All faces cleared successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get single face by ID
      if (path.startsWith('/data/') && request.method === 'GET') {
        const id = path.split('/')[2];
        const result = await env.DB.prepare(
          'SELECT id, name, vector, created_at FROM faces WHERE id = ?'
        ).bind(id).first();

        if (!result) {
          return new Response(JSON.stringify({ error: 'Face not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Delete face by ID
      if (path.startsWith('/data/') && request.method === 'DELETE') {
        const id = path.split('/')[2];
        const result = await env.DB.prepare(
          'DELETE FROM faces WHERE id = ?'
        ).bind(id).run();

        return new Response(JSON.stringify({ 
          message: 'Face deleted successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 404 Not Found
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};