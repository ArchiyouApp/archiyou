/* tslint:disable */
/* eslint-disable */

/**
 * For JavaScript: an instance and a config as JSON in, a solution as JSON out; an error is thrown as a string.
 */
export function solve(instance_json: string, config_json: string): string;

/**
 * For JavaScript: the rules that a solution breaks for an instance and a config, as a JSON array of
 * sentences; `[]` when it breaks none.
 */
export function validate(instance_json: string, config_json: string, solution_json: string): string;
