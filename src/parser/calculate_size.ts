import * as BufferModule from 'buffer';
const Buffer = BufferModule.Buffer;

import { Binary } from '../binary';
import { normalizedFunctionString } from './utils';
import * as constants from '../constants';

// To ensure that 0.4 of node works correctly
function isDate(d: any): d is Date {
  return typeof d === 'object' && Object.prototype.toString.call(d) === '[object Date]';
}

export function calculateObjectSize(object: unknown, serializeFunctions: boolean, ignoreUndefined: boolean) {
  let totalLength = 4 + 1;

  if (Array.isArray(object)) {
    for (let i = 0; i < object.length; i++) {
      totalLength += calculateElement(
        i.toString(),
        object[i],
        serializeFunctions,
        true,
        ignoreUndefined
      );
    }
  } else {
    // If we have toBSON defined, override the current object

    if ((object as any).toBSON) {
      object = (object as any).toBSON();
    }

    // Calculate size
    for (let key in (object as any)) {
      totalLength += calculateElement(key, (object as any)[key], serializeFunctions, false, ignoreUndefined);
    }
  }

  return totalLength;
}

/**
 * @ignore
 * @api private
 */
function calculateElement(name: string, value: any, serializeFunctions: boolean, isArray: boolean, ignoreUndefined: boolean) {
  // If we have toBSON defined, override the current object
  if (value && (value as any).toBSON) {
    value = (value as any).toBSON();
  }

  switch (typeof value) {
    case 'string':
      return 1 + Buffer.byteLength(name, 'utf8') + 1 + 4 + Buffer.byteLength(value, 'utf8') + 1;
    case 'number':
      if (
        Math.floor(value) === value &&
        value >= constants.JS_INT_MIN &&
        value <= constants.JS_INT_MAX
      ) {
        if (value >= constants.BSON_INT32_MIN && value <= constants.BSON_INT32_MAX) {
          // 32 bit
          return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (4 + 1);
        } else {
          return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
        }
      } else {
        // 64 bit
        return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
      }
    case 'undefined':
      if (isArray || !ignoreUndefined)
        return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + 1;
      return 0;
    case 'boolean':
      return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (1 + 1);
    case 'object':
      if (value == null || (value as any)['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
        return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + 1;
      } else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
        return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (12 + 1);
      } else if (value instanceof Date || isDate(value)) {
        return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        return (
          (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (1 + 4 + 1) + value.length
        );
      } else if (
        value['_bsontype'] === 'Long' ||
        value['_bsontype'] === 'Double' ||
        value['_bsontype'] === 'Timestamp'
      ) {
        return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (8 + 1);
      } else if (value['_bsontype'] === 'Decimal128') {
        return (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (16 + 1);
      } else if (value['_bsontype'] === 'Code') {
        // Calculate size depending on the availability of a scope
        if (value.scope != null && Object.keys(value.scope).length > 0) {
          return (
            (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
            1 +
            4 +
            4 +
            Buffer.byteLength(value.code.toString(), 'utf8') +
            1 +
            calculateObjectSize(value.scope, serializeFunctions, ignoreUndefined)
          );
        } else {
          return (
            (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
            1 +
            4 +
            Buffer.byteLength(value.code.toString(), 'utf8') +
            1
          );
        }
      } else if (value['_bsontype'] === 'Binary') {
        // Check what kind of subtype we have
        if (value.sub_type === Binary.SUBTYPE_BYTE_ARRAY) {
          return (
            (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
            (value.position + 1 + 4 + 1 + 4)
          );
        } else {
          return (
            (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) + (value.position + 1 + 4 + 1)
          );
        }
      } else if (value['_bsontype'] === 'Symbol') {
        return (
          (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
          Buffer.byteLength(value.value, 'utf8') +
          4 +
          1 +
          1
        );
      } else if (value['_bsontype'] === 'DBRef') {
        // Set up correct object for serialization
        const ordered_values = Object.assign(
          {
            $ref: value.collection,
            $id: value.oid
          },
          value.fields
        );

        // Add db reference if it exists
        if (value.db != null) {
          ordered_values['$db'] = value.db;
        }

        return (
          (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
          1 +
          calculateObjectSize(ordered_values, serializeFunctions, ignoreUndefined)
        );
      } else if (
        value instanceof RegExp ||
        Object.prototype.toString.call(value) === '[object RegExp]'
      ) {
        return (
          (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
          1 +
          Buffer.byteLength(value.source, 'utf8') +
          1 +
          (value.global ? 1 : 0) +
          (value.ignoreCase ? 1 : 0) +
          (value.multiline ? 1 : 0) +
          1
        );
      } else if (value['_bsontype'] === 'BSONRegExp') {
        return (
          (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
          1 +
          Buffer.byteLength(value.pattern, 'utf8') +
          1 +
          Buffer.byteLength(value.options, 'utf8') +
          1
        );
      } else {
        return (
          (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
          calculateObjectSize(value, serializeFunctions, ignoreUndefined) +
          1
        );
      }
    case 'function':
      // WTF for 0.4.X where typeof /someregexp/ === 'function'
      if (
        value instanceof RegExp ||
        Object.prototype.toString.call(value) === '[object RegExp]' ||
        String.call(value) === '[object RegExp]'
      ) {
        return (
          (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
          1 +
          Buffer.byteLength(value.source, 'utf8') +
          1 +
          (value.global ? 1 : 0) +
          (value.ignoreCase ? 1 : 0) +
          (value.multiline ? 1 : 0) +
          1
        );
      } else {
        if (serializeFunctions && value.scope != null && Object.keys(value.scope).length > 0) {
          return (
            (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
            1 +
            4 +
            4 +
            Buffer.byteLength(normalizedFunctionString(value), 'utf8') +
            1 +
            calculateObjectSize(value.scope, serializeFunctions, ignoreUndefined)
          );
        } else if (serializeFunctions) {
          return (
            (name != null ? Buffer.byteLength(name, 'utf8') + 1 : 0) +
            1 +
            4 +
            Buffer.byteLength(normalizedFunctionString(value), 'utf8') +
            1
          );
        }
      }
  }

  return 0;
}
