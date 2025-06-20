import { IDataObject } from "n8n-workflow";

export interface IFilterField {
    field: string;
}

export interface IFilter {
    filterField: string;
    filterValue: string;
}

export interface ISortRule {
    field: string;
    direction: 'asc' | 'desc';
}

export interface IAdditionalFields {
    id?: number;
    limit?: number;
    filters?: {
        filters: IFilter[];
    };
    sortRule?: ISortRule;
}

// Define filterFields as a standalone function
export function filterFields(obj: any, keys: string[]): any {
    if (!keys.length) return obj;
    const filtered: Record<string, any> = {};
    for (const key of keys) {
        if (obj.hasOwnProperty(key)) {
            filtered[key] = obj[key];
        }
    }
    return filtered;
}

/**
 * Removes empty objects or values.
 */
export function cleanEmptyObjects(obj: any): any | undefined {
    if (obj === null || obj === undefined) return undefined;
    if (typeof obj === 'string' && obj.trim() === '') return undefined;
    if (Array.isArray(obj)) {
        const cleanedArray = obj.map(item => cleanEmptyObjects(item)).filter(item => item !== undefined);
        return cleanedArray.length > 0 ? cleanedArray : undefined;
    }
    if (typeof obj === 'object') {
        const newObj: IDataObject = {};
        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            const cleanedValue = cleanEmptyObjects(obj[key]);
            if (cleanedValue !== undefined) newObj[key] = cleanedValue;
        }
        return Object.keys(newObj).length > 0 ? newObj : undefined;
    }
    return obj;
}

