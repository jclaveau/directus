import { EventEmitter, on } from 'events';
import { getMessenger } from '../../messenger.js';
import { getSchema } from '../../utils/get-schema.js';
import { ItemsService } from '../items.js';
const messages = createPubSub(new EventEmitter());
export function bindPubSub() {
    const messenger = getMessenger();
    messenger.subscribe('websocket.event', (message) => {
        messages.publish(`${message['collection']}_mutated`, message);
    });
}
export function createSubscriptionGenerator(self, event) {
    return async function* (_x, _y, _z, request) {
        const fields = parseFields(self, request);
        const args = parseArguments(request);
        for await (const payload of messages.subscribe(event)) {
            const eventData = payload;
            if ('event' in args && eventData['action'] !== args['event']) {
                continue; // skip filtered events
            }
            const schema = await getSchema();
            if (eventData['action'] === 'create') {
                const { collection, key } = eventData;
                const service = new ItemsService(collection, { schema });
                const data = await service.readOne(key, { fields });
                yield { [event]: { key, data, event: 'create' } };
            }
            if (eventData['action'] === 'update') {
                const { collection, keys } = eventData;
                const service = new ItemsService(collection, { schema });
                for (const key of keys) {
                    const data = await service.readOne(key, { fields });
                    yield { [event]: { key, data, event: 'update' } };
                }
            }
            if (eventData['action'] === 'delete') {
                const { keys } = eventData;
                for (const key of keys) {
                    yield { [event]: { key, data: null, event: 'delete' } };
                }
            }
        }
    };
}
function createPubSub(emitter) {
    return {
        publish: (event, payload) => void emitter.emit(event, payload),
        subscribe: async function* (event) {
            const asyncIterator = on(emitter, event);
            for await (const [value] of asyncIterator) {
                yield value;
            }
        },
    };
}
function parseFields(service, request) {
    const selections = request.fieldNodes[0]?.selectionSet?.selections ?? [];
    const dataSelections = selections.reduce((result, selection) => {
        if (selection.kind === 'Field' &&
            selection.name.value === 'data' &&
            selection.selectionSet?.kind === 'SelectionSet') {
            return selection.selectionSet.selections;
        }
        return result;
    }, []);
    const { fields } = service.getQuery({}, dataSelections, request.variableValues);
    return fields ?? [];
}
function parseArguments(request) {
    const args = request.fieldNodes[0]?.arguments ?? [];
    return args.reduce((result, current) => {
        if ('value' in current.value && typeof current.value.value === 'string') {
            result[current.name.value] = current.value.value;
        }
        return result;
    }, {});
}
