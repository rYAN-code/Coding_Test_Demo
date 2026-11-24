// Probe: verify Apollo Server 5.5.2 + @as-integrations/express5@1.1.2 + express 5 behaviour.
// Run from Backend_Coding_Test_Demo: node docs/probes/probe-express.mjs
import http from 'http';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { expressMiddleware } from '@as-integrations/express5';
import {
  GraphQLError,
  GraphQLScalarType,
  Kind,
  valueFromASTUntyped,
} from 'graphql';

const TOKEN = 'secret-token';

const Long = new GraphQLScalarType({
  name: 'Long',
  description: 'Integer wider than GraphQL Int; serialized as number when safe, else string.',
  serialize(value) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
    throw new GraphQLError('Long cannot represent value: ' + String(value));
  },
  parseValue(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
      const n = Number(value);
      return Number.isSafeInteger(n) ? n : value;
    }
    throw new GraphQLError('Long cannot represent value: ' + String(value));
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.INT) {
      const n = Number(ast.value);
      return Number.isSafeInteger(n) ? n : ast.value;
    }
    if (ast.kind === Kind.STRING) return ast.value;
    throw new GraphQLError('Long cannot represent literal kind: ' + ast.kind);
  },
});

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value.',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral: (ast) => valueFromASTUntyped(ast),
});

const typeDefs = `#graphql
  scalar Long
  scalar JSON
  type Query {
    longValue: Long
    longString: Long
    jsonValue: JSON
    echoJson(x: JSON!): JSON
    echoLong(x: Long!): Long
  }
`;

const resolvers = {
  Long,
  JSON: JSONScalar,
  Query: {
    longValue: () => 123456789,
    longString: () => '9007199254740993',
    jsonValue: () => ({ a: [1, 2], b: null, c: 'x' }),
    echoJson: (_p, args) => args.x,
    echoLong: (_p, args) => args.x,
  },
};

const app = express();
const httpServer = http.createServer(app);
const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
});
await server.start();

const http401 = (msg) =>
  new GraphQLError(msg, {
    extensions: {
      code: 'UNAUTHENTICATED',
      http: { status: 401, headers: new Map([['www-authenticate', 'Bearer']]) },
    },
  });

app.use(
  '/',
  cors(),
  express.json(),
  expressMiddleware(server, {
    context: async ({ req }) => {
      const header = req.headers.authorization;
      if (header !== `Bearer ${TOKEN}`) throw http401('Missing or invalid Bearer token');
      return { token: TOKEN };
    },
  }),
);

await new Promise((r) => httpServer.listen({ port: 5111 }, r));
const base = 'http://localhost:5111/';
const log = (name, v) => console.log('TEST', name, typeof v === 'string' ? v : JSON.stringify(v));

const post = (headers, body) =>
  fetch(base, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

// 1. landing page in dev (default plugin, GET + accept text/html)
try {
  const r = await fetch(base, { headers: { accept: 'text/html' } });
  const text = await r.text();
  log('landing-page', {
    status: r.status,
    contentType: r.headers.get('content-type'),
    embeddedSandbox: text.includes('sandbox.embed.apollographql.com'),
    cdn: text.includes('apollo-server-landing-page.cdn.apollographql.com'),
    length: text.length,
  });
} catch (e) {
  log('landing-page', { error: String(e) });
}

// 2. unauth POST application/json -> 401 UNAUTHENTICATED
try {
  const r = await post({ 'content-type': 'application/json' }, { query: '{ longValue }' });
  const j = await r.json();
  log('401-json', { status: r.status, code: j.errors?.[0]?.extensions?.code, msg: j.errors?.[0]?.message, wwwAuth: r.headers.get('www-authenticate'), body: j });
} catch (e) {
  log('401-json', { error: String(e) });
}

// 3. wrong bearer
try {
  const r = await post({ 'content-type': 'application/json', authorization: 'Bearer nope' }, { query: '{ longValue }' });
  const j = await r.json();
  log('401-wrong-token', { status: r.status, code: j.errors?.[0]?.extensions?.code });
} catch (e) {
  log('401-wrong-token', { error: String(e) });
}

// 4. happy path + custom scalars (serialize + parseLiteral + parseValue)
try {
  const r = await post(
    { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    {
      query:
        'query Q($j: JSON!) { longValue longString jsonValue echoJson(x: {a:[1,2],b:null}) echoLong(x: 42) echoLongStr: echoLong(x: "123") jsonVar: echoJson(x: $j) }',
      variables: { j: { nested: true, n: 1 } },
    },
  );
  const j = await r.json();
  log('happy-scalars', { status: r.status, errors: j.errors?.map((e) => e.message), data: j.data });
} catch (e) {
  log('happy-scalars', { error: String(e) });
}

// 5. CSRF: form-urlencoded content type, body parsed by express.urlencoded, no preflight header
try {
  const r = await post(
    { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${TOKEN}` },
    'query=%7B++longValue+%7D',
  );
  const text = await r.text();
  log('csrf-form-post', { status: r.status, body: text.slice(0, 220) });
} catch (e) {
  log('csrf-form-post', { error: String(e) });
}

// 6. CORS preflight for browser (Authorization header triggers preflight)
try {
  const r = await fetch(base, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://sandbox.embed.apollographql.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, authorization, apollo-require-preflight, x-apollo-operation-name',
    },
  });
  log('preflight', {
    status: r.status,
    origin: r.headers.get('access-control-allow-origin'),
    headers: r.headers.get('access-control-allow-headers'),
    methods: r.headers.get('access-control-allow-methods'),
  });
} catch (e) {
  log('preflight', { error: String(e) });
}

// 7. @apollo/server root does NOT export expressMiddleware / has no express5 subpath
try {
  await import('@apollo/server/express5');
  log('express5-subpath', 'UNEXPECTED: resolved');
} catch (e) {
  log('express5-subpath', { expectedFailure: e.code || e.constructor.name, msg: String(e.message).slice(0, 120) });
}

await server.stop();
httpServer.close();
console.log('DONE express probe');
