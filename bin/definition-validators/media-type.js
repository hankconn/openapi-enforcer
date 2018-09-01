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
const Encoding      = require('./encoding');
const Example       = require('./example');
const Schema        = require('./schema');

const rxContentTypeMime = /(?:^multipart\/)|(?:^application\/x-www-form-urlencoded$)/;

module.exports = data => {
    return {
        type: 'object',

        properties: {
            schema: Schema,
            example: { allowed: true },
            examples: {
                type: 'object',
                additionalProperties: Example
            },
            encoding: {
                type: 'object',
                allowed: ({ key, parent }) => {
                    if (!rxContentTypeMime.test(parent.key)) {
                        return 'Mime type must be multipart/* or application/x-www-form-urlencoded. Found: ' + parent.key
                    } else if (parent.parent.parent.validator !== require('./request-body')) {
                        return 'The encoding validator is only allowed for requestBody objects';
                    } else {
                        return true;
                    }
                },
                additionalProperties: Encoding
            }
        }
    };
};