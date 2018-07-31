/**
 *  @license
 *    Copyright 2018 Brigham Young University
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 **/
'use strict';
const Exception     = require('../exception');
const formatter     = require('./formatter');
const merge         = require('./merge');
const populate      = require('./populate');
const random        = require('./random');
const rx            = require('../rx');
const serial        = require('./serialize');
const util          = require('../util');
const validate      = require('./validate');

const rxExtension = /^x-.+/;
const store = new WeakMap();

module.exports = Schema;

function Schema(exception, version, schema, options, map) {

    // already processed schema instances can be returned now
    if (schema instanceof Schema) return schema;

    // watch for cyclic building
    const existing = map.get(schema);
    if (existing) return existing;
    map.set(schema, this);

    // store protected variables
    store.set(this, {
        exception: exception,
        options: options,
        version: version
    });

    // validate that only the allowed properties are specified and copy properties to this
    const validations = version.validationsMap;
    const common = validations.common;
    const keys = Object.keys(schema);
    const length = keys.length;
    const composites = [];
    let skipDefaultValidations = false;
    const enumErrors = {};
    const type = schema.type;
    const typeProperties = validations.types[type] || {};
    for (let i = 0; i < length; i++) {
        const key = keys[i];

        if (rxExtension.test(key)) {
            this[key] = schema[key];

        // validate that the property is allowed
        } else if (!(common[key] || typeProperties[key] || validations.composites[key] || allowProperty(schema, key, version.value))) {
            exception('Property not allowed: ' + key);

        } else {
            const value = schema[key];
            if (value instanceof Date) {
                this[key] = new Date(+value);
            } else if (value instanceof Buffer) {
                this[key] = value.slice(0);
            } else if (Array.isArray(value)) {
                this[key] = value.concat();
            } else if (util.isPlainObject(value)) {
                this[key] = Object.assign({}, value)
            } else {
                this[key] = schema[key];
            }

            // keep track of composites
            if (validations.composites[key]) composites.push(key);
        }
    }

    // cannot have multiple of allOf, oneOf, anyOf, not, etc.
    if (composites.length > 1) {
        exception('Cannot have multiple composites: ' + composites.join(', '));

    } else if (composites.length === 1) {
        const composite = composites[0];
        switch (composite) {
            case 'allOf':
            case 'anyOf':
            case 'oneOf':
                if (!Array.isArray(this[composite])) {
                    exception('Composite "' + composite + '" must be an array');
                } else {
                    this[composite] = this[composite]
                        .map((schema, index) => new Schema(exception.nest(composite + ' has one or more errors at index ' + index), version, schema, options, map));
                }
                break;

            case 'not':
                if (!util.isPlainObject(this.not)) {
                    exception('Composite "not" must be an object');
                } else {
                    this.not = new Schema(exception.nest('not'), version, this.not, options, map);
                }
                break;
        }

    } else if (!type) {
        exception.first('Missing required property: type');

    } else if (!validations.types[type]) {
        exception('Invalid type specified. Expected one of: ' + Object.keys(validations.types).join(', '));

    } else if (type === 'array') {
        if (this.items) {
            if (util.isPlainObject(this.items)) {
                this.items = new Schema(exception.nest('items'), version, this.items, options, map);
            } else {
                exception('Property "items" must be an object');
            }
        }
        if (this.hasOwnProperty('maxItems') && !isNonNegativeInteger(this.maxItems)) {
            exception('Property "maxItems" must be a non-negative integer');
        }
        if (this.hasOwnProperty('minItems') && !isNonNegativeInteger(this.minItems)) {
            exception('Property "minItems" must be a non-negative integer');
        }
        if (!minMaxValid(this.minItems, this.maxItems)) {
            exception('Property "minItems" must be less than or equal to "maxItems"');
        }

    } else if (type === 'boolean') {
        // nothing to do here (yet)

    } else if (type === 'integer') {
        if (this.hasOwnProperty('format') && !validations.formats.integer[this.format]) {
            exception('Invalid "format" specified. Expected one of: ' + Object.keys(validations.formats.integer).join(', '));
        }
        if (this.hasOwnProperty('maximum') && !isInteger(this.maximum)) {
            exception('Property "maximum" must be an integer');
        }
        if (this.hasOwnProperty('minimum') && !isInteger(this.minimum)) {
            exception('Property "minimum" must be an integer');
        }
        if (!minMaxValid(this.minimum, this.maximum, this.exclusiveMinimum, this.exclusiveMaximum)) {
            const msg = this.exclusiveMinimum || this.exclusiveMaximum ? '' : 'or equal to ';
            exception('Property "minimum" must be less than ' + msg + '"maximum"');
        }
        if (this.hasOwnProperty('multipleOf') && (!isInteger(this.multipleOf) || this.multipleOf < 1)) {
            exception('Property "multipleOf" must be a positive integer');
        }

    } else if (type === 'number') {
        if (this.hasOwnProperty('format') && !validations.formats.number[this.format]) {
            exception('Invalid "format" specified. Expected one of: ' + Object.keys(validations.formats.number).join(', '));
        }
        if (this.hasOwnProperty('maximum') && typeof this.maximum !== 'number') {
            exception('Property "maximum" must be a number');
        }
        if (this.hasOwnProperty('minimum') && typeof this.minimum !== 'number') {
            exception('Property "minimum" must be a number');
        }
        if (!minMaxValid(this.minimum, this.maximum, this.exclusiveMinimum, this.exclusiveMaximum)) {
            const msg = this.exclusiveMinimum || this.exclusiveMaximum ? '' : 'or equal to ';
            exception('Property "minimum" must be less than ' + msg + '"maximum"');
        }
        if (this.hasOwnProperty('multipleOf') && (typeof this.multipleOf !== 'number' || this.multipleOf === 0)) {
            exception('Property "multipleOf" must be a positive number');
        }

    } else if (type === 'object') {
        if (this.hasOwnProperty('maxProperties') && !isNonNegativeInteger(this.maxProperties)) {
            exception('Property "maxProperties" must be a non-negative integer');
        }
        if (this.hasOwnProperty('minProperties') && !isNonNegativeInteger(this.minProperties)) {
            exception('Property "minProperties" must be a non-negative integer');
        }
        if (!minMaxValid(this.minProperties, this.maxProperties)) {
            exception('Property "minProperties" must be less than or equal to "maxProperties"');
        }
        if (this.hasOwnProperty('discriminator')) {
            const child = exception.nest('Discriminator has one or more errors');
            let discriminator = this.discriminator;
            switch (version.value) {
                case 2:
                    if (typeof discriminator !== 'string') {
                        child('Discriminator must be a string');
                    } else if (!Array.isArray(this.required) || this.required.indexOf(discriminator) === -1) {
                        child('Property "' + discriminator + '" must be listed as required');
                    }
                    break;

                case 3:
                    if (!discriminator || typeof discriminator !== 'object') {
                        child('Discriminator must be an object with property "propertyName" as a string');
                    } else if (!discriminator.hasOwnProperty('propertyName')) {
                        child('Missing required property: propertyName');
                    } else if (typeof discriminator.propertyName !== 'string') {
                        child('Property "propertyName" must be a string');
                    } else {
                        if (!Array.isArray(this.required) || this.required.indexOf(discriminator.propertyName) === -1) {
                            child('Property "' + discriminator.propertyName + '" must be listed as required');
                        }
                        if (discriminator.hasOwnProperty('mapping')) {
                            if (!util.isPlainObject(discriminator.mapping)) {
                                child('Property "mapping" must be an object');
                            } else {
                                const mapping = discriminator.mapping;
                                Object.keys(mapping).forEach(key => {
                                    const schema = mapping[key];
                                    if (!util.isPlainObject(schema)) {
                                        child('Mapped value for "' + key + '" must be an object');
                                    } else {
                                        mapping[key] = new Schema(exception.nest('Mapping has one or more errors'), version, schema, options, map);
                                    }
                                });
                            }
                        }
                    }
                    break;
            }
            if (options.freeze) Object.freeze(discriminator);
        }
        if (this.hasOwnProperty('required')) {
            if (!Array.isArray(this.required) || this.required.filter(v => v && typeof v === 'string').length !== this.required.length) {
                exception('Property "required" must be an array of non-empty strings');
            } else if (this.hasOwnProperty('maxProperties') && this.required.length > this.maxProperties) {
                exception('The number or "required" properties exceeds the "maxProperties" value');
            }
        }
        if (this.additionalProperties) {
            if (util.isPlainObject(this.additionalProperties)) {
                this.additionalProperties = new Schema(exception.nest('additionalProperties'), version, this.additionalProperties, options, map);
            } else if (this.additionalProperties !== true) {
                exception('Property "additionalProperties" must be an object');
            }
        }
        if (this.properties) {
            if (!util.isPlainObject(this.properties)) {
                exception('Property "properties" must be an object');
            } else {
                const subException = exception.nest('Property "properties" has one or more errors');
                Object.keys(this.properties).forEach(key => {
                    const subSchema = this.properties[key];
                    if (util.isPlainObject(subSchema)) {
                        this.properties[key] = new Schema(subException.nest('Property "' + key + '" has one or more errors'), version, subSchema, options, map);
                    } else {
                        subException('Property "' + key + '" must be an object');
                    }
                })
            }
        }

    } else if (type === 'string') {
        const isDateFormat = this.format && (this.format === 'date' || this.format === 'date-time');
        if (this.hasOwnProperty('format') && !validations.formats.string[this.format]) {
            exception('Invalid "format" specified. Expected one of: ' + Object.keys(validations.formats.string).join(', '));
        }
        if (isDateFormat) {
            let valid = true;
            if (this.hasOwnProperty('maximum')) {
                if (!rx[this.format].test(this.maximum)) {
                    exception('Property "maximum" is not formatted as a ' + this.format);
                    valid = false;
                } else {
                    const date = util.getDateFromValidDateString(this.format, this.maximum);
                    if (!date) {
                        exception('Property "maximum" is not a valid ' + this.format);
                        valid = false;
                    } else {
                        if (options.freeze) util.deepFreeze(date);
                        this.maximum = date;
                    }
                }
            }
            if (this.hasOwnProperty('minimum')) {
                if (!rx[this.format].test(this.minimum)) {
                    exception('Property "minimum" is not formatted as a ' + this.format);
                    valid = false;
                } else {
                    const date = util.getDateFromValidDateString(this.format, this.minimum);
                    if (!date) {
                        exception('Property "minimum" is not a valid ' + this.format);
                        valid = false;
                    } else {
                        if (options.freeze) util.deepFreeze(date);
                        this.minimum = date;
                    }
                }
            }
            if (valid && !minMaxValid(this.minimum, this.maximum, this.exclusiveMinimum, this.exclusiveMaximum)) {
                const msg = this.exclusiveMinimum || this.exclusiveMaximum ? '' : 'or equal to ';
                exception('Property "minimum" must be less than ' + msg + '"maximum"');
            }
        } else {
            if (this.hasOwnProperty('maximum')) {
                exception('Property "maximum" not allowed unless format is "date" or "date-time"');
            }
            if (this.hasOwnProperty('minimum')) {
                exception('Property "minimum" not allowed unless format is "date" or "date-time"');
            }
            if (this.hasOwnProperty('exclusiveMaximum')) {
                exception('Property "exclusiveMaximum" not allowed unless format is "date" or "date-time"');
            }
            if (this.hasOwnProperty('exclusiveMinimum')) {
                exception('Property "exclusiveMinimum" not allowed unless format is "date" or "date-time"');
            }
        }
        if (this.hasOwnProperty('maxLength') && !isNonNegativeInteger(this.maxLength)) {
            exception('Property "maxLength" must be a non-negative integer');
        }
        if (this.hasOwnProperty('minLength') && !isNonNegativeInteger(this.minLength)) {
            exception('Property "minLength" must be a non-negative integer');
        }
        if (!minMaxValid(this.minLength, this.maxLength)) {
            exception('Property "minimum" must be less than or equal to "maximum"');
        }
        if (this.hasOwnProperty('pattern') && typeof this.pattern !== 'string') {
            exception('Property "pattern" must be a string');
        }

        // parse pattern string into a regular expression
        if (this.pattern) this.pattern = rxStringToRx(this.pattern);

        // parse default value
        if (this.hasOwnProperty('default')) {
            const data = formatter.deserialize(exception.nest('Unable to parse default value'), this, this.default);
            if (data.error) {
                console.log(exception.toString());
                skipDefaultValidations = true;
            } else {
                if (isDateFormat && options.freeze) util.deepFreeze(data.value);
                this.default = data.value;
            }
        }

        // parse enum values
        if (this.hasOwnProperty('enum') && Array.isArray(this.enum)) {
            const length = this.enum.length;
            for (let i = 0; i < length; i++) {
                const child = Exception('Unable to parse enum value at index ' + i);
                const data = formatter.deserialize(child, this, this.enum[i]);
                if (data.error) {
                    enumErrors[i] = child;
                } else {
                    if (isDateFormat && options.freeze) util.deepFreeze(data.value);
                    this.enum[i] = data.value;
                }
            }
        }
    }

    if (type) {
        // validate default value
        if (this.hasOwnProperty('default') && !skipDefaultValidations) {
            const childException = this.validate(this.default);
            if (childException) {
                childException.header = 'Default value is not valid';
                exception(childException);
            }
        }

        // validate enum values
        if (this.hasOwnProperty('enum')) {
            if (!Array.isArray(this.enum)) {
                exception('Property "enum" must be an array');
            } else {
                const length = this.enum.length;
                for (let i = 0; i < length; i++) {
                    if (enumErrors[i]) {
                        exception(enumErrors[i]);
                    } else {
                        const childException = this.validate(this.enum[i]);
                        if (childException) {
                            childException.header = 'Enum value at index ' + i + ' is not valid';
                            exception(childException);
                        }
                    }
                }
            }
        }
    }

    // check for invalid discriminator placement
    if (version.value === 3 && this.discriminator) {
        if (type !== 'object' && !this.oneOf && !this.anyOf) {
            exception('Discriminator only allowed in objects or along with anyOf or oneOf');
        }
    }

    if (options.freeze) Object.freeze(this);
}

/**
 * Take a serialized (ready for HTTP transmission) value and deserialize it.
 * Converts strings of binary, byte, date, and date-time to JavaScript equivalents.
 * @param {*} value
 * @returns {{ error: Exception|null, value: * }}
 */
Schema.prototype.deserialize = function(value) {
    const data = store.get(this);
    if (!data) throw Error('Expected a Schema instance type');
    return serial.deserialize(this, value);
};

/**
 * Check if the schema has any exceptions or get the Exception object.
 * @param {boolean} [force=false] Set to true to get the Exception object even if there is no exception.
 * @returns {Exception|null}
 */
Schema.prototype.exception = function(force) {
    const data = store.get(this);
    if (!data) throw Error('Expected a Schema instance type');
    return force || data.exception.hasException ? data.exception : null;
};

/**
 * Merge two or more schemas.
 * @param {...Schema|object} schema
 * @param {object} [options]
 * @param {boolean} [options.overwriteDiscriminator=false] Set to true to allow conflicting discriminators to overwrite the previous, otherwise causes exceptions.
 * @param {boolean} [options.orPattern=false]
 * @param {boolean} [options.throw=true]
 */
Schema.prototype.merge = function(schema, options) {
    const data = store.get(this);
    if (!data) throw Error('Expected a Schema instance type');

    options = Object.assign({}, options);
    if (!options.hasOwnProperty('throw')) options.throw = true;

    // get schemas array
    const schemas = Array.from(arguments)
        .map(schema => schema instanceof Schema
            ? schema
            : Schema(Exception('Schema has one or more errors'), data.version, schema, data.options));

    // at this schema to the list of schemas
    args.unshift(this);

    const merged = merge(schemas, options);
    const exception = merged.exception();
    if (exception || options.throw) throw Error(exception.toString());
    return merged;
};

/**
 * Populate a value from a list of parameters.
 * @param {object} params
 * @param {*} [value]
 * @param {object} [options]
 * @param {boolean} [options.copy]
 * @param {boolean} [options.oneOf]
 * @param {string} [options.replacement]
 * @param {boolean} [options.reportErrors]
 * @param {boolean} [options.serialize]
 * @param {boolean} [options.templateDefaults]
 * @param {boolean} [options.templates]
 * @param {boolean} [options.variables]
 * @returns {{ error: Exception|null, value: * }}
 */
Schema.prototype.populate = function(params, value, options) {
    return populate.populate(this, params, value, options);
};

/**
 * Produce a random value for the schema.
 * @param {*} value An initial value to add random values to.
 * @param {object} [options]
 * @param {boolean} [options.skipInvalid=false]
 * @param {boolean} [options.throw=true]
 * @returns {*}
 */
Schema.prototype.random = function(value, options) {
    if (!options) options = {};
    if (!options.hasOwnProperty('skipInvalid')) options.skipInvalid = false;
    if (!options.hasOwnProperty('throw')) options.throw = true;
    const data = random(this, value);
    return util.errorHandler(options.throw, data.error, data.value);
};

/**
 * Take a deserialized (not ready for HTTP transmission) value and serialize it.
 * Converts Buffer and Date objects into string equivalent.
 * @param value
 * @returns {*}
 */
Schema.prototype.serialize = function(value) {
    return serial.serialize(this, value);
};

/**
 * Check to see if the value is valid for this schema.
 * @param {*} value
 * @returns {Exception|null}
 */
Schema.prototype.validate = function(value) {
    return validate(this, value);
};

/**
 * Get the OpenAPI version used for this schema.
 */
Object.defineProperty(Schema.prototype, 'version', {
    get: function() {
        const data = store.get(this);
        if (!data) throw Error('Expected a Schema instance type');
        return data.version;
    }
});




// put custom property checks here
function allowProperty(schema, property, version) {
    if (property === 'discriminator') return true;
    return false;
}

function greatestCommonDenominator(x, y) {
    x = Math.abs(x);
    y = Math.abs(y);
    while(y) {
        const t = y;
        y = x % y;
        x = t;
    }
    return x;
}

function highestNumber(n1, n2) {
    const t1 = typeof n1 === 'number';
    const t2 = typeof n2 === 'number';
    if (t1 && t2) return n1 < n2 ? n2 : n1;
    return t1 ? n1 : n2;
}

function isInteger(value) {
    return typeof value === 'number' && Math.round(value) === value;
}

function isNonNegativeInteger(value) {
    return isInteger(value) && value >= 0;
}

function leastCommonMultiple(x, y) {
    if ((typeof x !== 'number') || (typeof y !== 'number'))
        return false;
    return (!x || !y) ? 0 : Math.abs((x * y) / greatestCommonDenominator(x, y));
}

function lowestNumber(n1, n2) {
    const t1 = typeof n1 === 'number';
    const t2 = typeof n2 === 'number';
    if (t1 && t2) return n1 > n2 ? n2 : n1;
    return t1 ? n1 : n2;
}

function minMaxValid(min, max, exclusiveMin, exclusiveMax) {
    if (min === undefined || max === undefined) return true;
    min = +min;
    max = +max;
    return min < max || (!exclusiveMin && !exclusiveMax && min === max);
}

function rxStringToRx(value) {
    if (typeof value === 'string') {
        const rx = /^\/([\s\S]+?)\/(\w*)?$/;
        const match = rx.exec(value);
        return match
            ? RegExp(match[1], match[2] || '')
            : RegExp(value);
    } else if (value instanceof RegExp) {
        return value;
    } else {
        throw Error('Cannot convert value to RegExp instance');
    }
}

function rxMerge(rx1, rx2) {
    rx1 = rxStringToRx(rx1);
    rx2 = rxStringToRx(rx2);
    const source = rx1.source + '|' + rx2.source;
    const flags = util.arrayUnique((rx1.flags + rx2.flags).split('')).join('');
    return RegExp(source, flags);
}