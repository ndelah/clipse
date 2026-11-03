import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Renderer, ActionProvider, StateProvider, VisibilityProvider, defineRegistry} from '@json-render/react';
import {catalog, preset, validateLayout} from '../experiments/summary-ui/model.js';

test('both layouts render through the actual json-render registry', () => {
  const {registry} = defineRegistry(catalog, {components: Object.fromEntries(['Stack', 'Overview', 'Takeaways', 'Detail'].map(type => [type, ({props, children}) => React.createElement('section', null, props.title, children)]))});
  for (const compact of [true, false]) {
    const spec = validateLayout(preset(compact));
    const html = renderToStaticMarkup(React.createElement(StateProvider, {initialState: {}}, React.createElement(VisibilityProvider, null, React.createElement(ActionProvider, {handlers: {}}, React.createElement(Renderer, {spec, registry})))));
    assert.match(html, /At a glance/);
    assert.equal(html.includes('Full summary'), !compact);
  }
});
test('invalid graphs, types, props and executable extras are rejected', () => {
  for (const mutate of [s => s.elements.summary.children.push('summary'), s => s.elements.summary.children.push('missing'), s => s.elements.overview.type = 'script', s => s.elements.overview.props.title = 123, s => s.elements.overview.on = {click: 'evil'}, s => s.elements.orphan = {type: 'Stack', props: {}}]) {
    const spec = preset(); mutate(spec); assert.throws(() => validateLayout(spec));
  }
});
