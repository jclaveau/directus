import express from 'express';
import { expect, test } from 'vitest';
import { rootOf, routerRootPaths } from './router-root-paths.js';

const noop = () => {};

test('names the first segment of each route and mount, once', () => {
	const router = express.Router();
	const scoped = express.Router();

	router.use('/studying', scoped);
	router.use('/studying/deep', scoped);
	router.get('/revising', noop);
	router.post('/revising/:id', noop);
	router.route('/a.b-c_d~').get(noop);

	expect(routerRootPaths(router)).toEqual({
		paths: ['/studying', '/revising', '/a.b-c_d~'],
		dynamic: [],
	});
});

// An endpoint extension with `id: ''` is mounted at `/` by the manager and its
// own routes name the paths
test('walks a router mounted at the root', () => {
	const router = express.Router();
	const bundle = express.Router();
	const deeper = express.Router();

	bundle.get('/authentication/login', noop);
	bundle.use('/administration', deeper);
	router.use('/', bundle);
	router.use('/named', bundle);
	router.use('/', (_req, _res, next) => next());

	expect(routerRootPaths(router)).toEqual({
		paths: ['/authentication', '/administration', '/named'],
		dynamic: [],
	});
});

test('sets a route or mount with no literal first segment apart', () => {
	const router = express.Router();
	const bundle = express.Router();

	bundle.get('/:pk', noop);
	bundle.get(['/ok', '*'], noop);
	router.use('/', bundle);
	router.use('/:tenant/items', bundle);
	router.use('/wild/*', bundle);

	expect(routerRootPaths(router)).toEqual({
		paths: ['/ok'],
		dynamic: [
			'/:pk',
			'*',
			'^(?:\\/([^/]+?))\\/items\\/?(?=\\/|$)',
			'^\\/wild\\/(.*)\\/?(?=\\/|$)',
		],
	});
});

test.each([
	['/', '/'],
	['/files', '/files'],
	['/files/tus', '/files'],
	['/a/b/c', '/a'],
])('rootOf(%s) is %s', (path, root) => {
	expect(rootOf(path)).toBe(root);
});
