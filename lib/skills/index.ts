/**
 * Built-in skills registry.
 * Import this module to register all built-in skills.
 */

import { registerSkill } from '../skill';
import { currentDateTime } from './currentDateTime';

registerSkill(currentDateTime);

export { currentDateTime };
