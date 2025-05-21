import {
	IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, NodeOperationError, IHttpRequestMethods, IDataObject
} from 'n8n-workflow';

import  {
	cleanEmptyObjects, filterFields, IAdditionalFields, IFilter, IFilterField, IProductData, IThirdpartyData
} from './DolibarrUtils';

export class Dolibarr implements INodeType {
	description: INodeTypeDescription = {
			displayName: 'Dolibarr',
			name: 'dolibarr',
			icon: 'file:dolibarr.svg',
			group: ['input'],
			version: 1,
			subtitle: '={{$parameter["operation"].toUpperCase()}} = {{$parameter["resource"]}}',
			description: 'Interact with Dolibarr API',
			defaults: {
					name: 'Dolibarr',
			},
			inputs: ['main'],
			outputs: ['main'],
			credentials: [
					{
							name: 'dolibarrApi',
							required: true,
					},
			],
			properties: [
					{
							displayName: 'Resource',
							name: 'resource',
							type: 'options',
							noDataExpression: true,
							options: [
									{ name: 'Bank', value: 'bankaccounts' },
									{ name: 'Contact', value: 'contacts' },
									{ name: 'Expense', value: 'expensereports' },
									{ name: 'Facture', value: 'invoices' },
									{ name: 'Order', value: 'orders' },
									{ name: 'Payment', value: 'payments' },
									{ name: 'Produit', value: 'products' },
									{ name: 'Project', value: 'projects' },
									{ name: 'Proposal', value: 'proposals' },
									{ name: 'Société', value: 'thirdparties' },
									{ name: 'Utilisateur', value: 'users' },
									{ name: 'Warehouse', value: 'warehouses' },
							],
							default: 'users',
					},
					{
							displayName: 'Operation',
							name: 'operation',
							type: 'options',
							noDataExpression: true,
							options: [
									{ name: 'Get', value: 'get' },
									{ name: 'Create', value: 'create' },
									{ name: 'Update', value: 'update' },
									{ name: 'Delete', value: 'delete' },
							],
							default: 'get',
					},
					{
							displayName: 'ID',
							name: 'id',
							type: 'number',
							default: 1,
							required: true,
							description: 'ID of the resource to update or delete',
							displayOptions: {
									show: {
											operation: ['update', 'delete'],
									},
							},
					},
					{
							displayName: 'Fields to Keep',
							name: 'filterFields',
							type: 'fixedCollection',
							placeholder: 'Add fields to keep',
							description: 'Only these fields will be returned in the output',
							typeOptions: {
									multipleValues: true,
									sortable: true,
							},
							default: {},
							displayOptions: {
									show: {
											operation: ['get'],
									},
							},
							options: [
									{
											displayName: 'Fields',
											name: 'fields',
											values: [
													{
															displayName: 'Field Name',
															name: 'field',
															type: 'string',
															default: '',
													},
											],
									},
							],
					},
					{
							displayName: 'Additional Fields',
							name: 'additionalFields',
							type: 'collection',
							placeholder: 'Add Parameter',
							default: {},
							displayOptions: {
									show: {
											operation: ['get'],
									},
							},
							options: [
								{
									displayName: 'Fetch Purchase Prices',
									name: 'fetchPurchasePrices',
									type: 'boolean',
									default: false,
									description: 'Whether to fetch purchase prices for products',
									displayOptions: {
										show: {
											'/resource': ['products'],
										},
									},
								},
								{
									displayName: 'Filters',
									name: 'filters',
									type: 'fixedCollection',
									placeholder: 'Add Filter',
									typeOptions: {
										multipleValues: true,
									},
									default: {},
									description: 'Filters to apply',
									options: [
										{
											name: 'filters',
											displayName: 'Filter',
											values: [
												{
													displayName: 'Field Name',
													name: 'filterField',
													type: 'string',
													default: '',
													description: 'Name of the field to filter after API response',
												},
												{
													displayName: 'Value',
													name: 'filterValue',
													type: 'string',
													default: '',
													description: 'Value to filter for',
												},
											],
										},
									],
								},
								{
									displayName: 'Format Response Data',
									name: 'formatResponseData',
									type: 'boolean',
									default: false,
									description: 'Whether to format the response data with specific field mappings',
									displayOptions: {
										show: {
											'/resource': ['products'],
										},
									},
								},
								{
									displayName: 'ID',
									name: 'id',
									type: 'number',
									default: 1,
									description: 'ID of the resource. If not provided, lists resources.',
								},
								{
									displayName: 'Limit',
									name: 'limit',
									type: 'number',
									default: 50,
									typeOptions: { minValue: 1 },
									description: 'Max number of results to return',
								},
								{
									displayName: 'Purchase Price API URL',
									name: 'purchasePriceUrl',
									type: 'hidden',
									default: 'http://Dolibarr-Server',
									description: 'Base URL for purchase price API',
									displayOptions: {
										show: {
											'/resource': ['products'],
											fetchPurchasePrices: [true],
										},
									},
								},
								{
									displayName: "Sort",
									name: "sortRule",
									type: "collection",
									default: {
										field: "id",
										direction: "asc"
									},
									description: "Field to sort by and its direction",
									options: [
										{
											displayName: "Field Name",
											name: "field",
											type: "string",
											default: "id",
											description: "Field name to sort by"
										},
										{
											displayName: "Order",
											name: "direction",
											type: "options",
											default: "asc",
											options: [
												{ name: "Ascending", value: "asc" },
												{ name: "Descending", value: "desc" }
											]
										}
									]
								},
							],
					},
			],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
			const items = this.getInputData();
			const resource = this.getNodeParameter('resource', 0) as string;
			const operation = this.getNodeParameter('operation', 0) as string;
			const credentials = await this.getCredentials('dolibarrApi');
			const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');
			const apiKey = credentials.apiKey as string;

			const returnData: INodeExecutionData[] = [];

			for (let i = 0; i < items.length; i++) {
					try {
							let url = `${baseUrl}/api/index.php/${resource}`;
							let method: IHttpRequestMethods = 'GET';
							let body: any = undefined;

							const headers = {
									'DOLAPIKEY': apiKey,
							};

							const filterCollection = this.getNodeParameter('filterFields', i, {}) as {
									fields?: IFilterField[];
							};
							const fieldsToKeep = (filterCollection.fields || []).map(f => f.field).filter(f => !!f);

							const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IAdditionalFields & {
									fetchPurchasePrices?: boolean;
									purchasePriceUrl?: string;
									formatResponseData?: boolean;
							};

							if (operation === 'get') {
									const { id, limit } = additionalFields;
									if (id) {
											url += `/${id}`;
									} else {
											const queryParams: string[] = [];
											if (limit) queryParams.push(`limit=${limit}`);
											if (queryParams.length) url += `?${queryParams.join('&')}`;
									}
							}

							if (['delete', 'update'].includes(operation)) {
									const id = this.getNodeParameter('id', i) as number;
									url += `/${id}`;
							}

							if (['create', 'update'].includes(operation)) {
									switch (resource) {
											case 'thirdparties':
													body = this.getNodeParameter('thirdpartyData', i) as IThirdpartyData;
													break;
											case 'products':
													body = this.getNodeParameter('productData', i) as IProductData;
													break;
											default:
													throw new NodeOperationError(this.getNode(), `Resource '${resource}' does not support create or update operations.`, { itemIndex: i });
									}
							}

							switch (operation) {
									case 'get':
											method = 'GET';
											break;
									case 'delete':
											method = 'DELETE';
											break;
									case 'create':
											method = 'POST';
											break;
									case 'update':
											method = 'PUT';
											break;
									default:
											throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, { itemIndex: i });
							}

							let response = await this.helpers.request({
									method,
									url,
									headers,
									body,
									json: true,
							});

							const filters = additionalFields.filters as IDataObject | undefined;

							if (
									filters?.filters &&
									Array.isArray(filters.filters) &&
									Array.isArray(response)
							) {
									for (const filter of filters.filters as IFilter[]) {
											const field = filter.filterField;
											const value = filter.filterValue;

											if (!field || value === undefined) continue;

											response = response.filter((item: any) => {
													const itemValue = item?.[field];
													return itemValue !== undefined && String(itemValue).toLowerCase() === String(value).toLowerCase();
											});
									}
							}

							const sortRule = additionalFields.sortRule;

							if (sortRule?.field && Array.isArray(response)) {
									const { field, direction } = sortRule;

									response.sort((a: any, b: any) => {
											const aVal = a?.[field];
											const bVal = b?.[field];

											if (aVal === undefined && bVal === undefined) return 0;
											if (aVal === undefined) return 1;
											if (bVal === undefined) return -1;

											if (typeof aVal === 'number' && typeof bVal === 'number') {
													return direction === 'desc' ? bVal - aVal : aVal - bVal;
											}

											const aStr = String(aVal).toLowerCase();
											const bStr = String(bVal).toLowerCase();

											if (aStr < bStr) return direction === 'desc' ? 1 : -1;
											if (aStr > bStr) return direction === 'desc' ? -1 : 1;
											return 0;
									});
							}

							// For products, fetch purchase prices if requested
							if (resource === 'products' && operation === 'get' && additionalFields.fetchPurchasePrices) {

									if (Array.isArray(response)) {
											// For list of products
											const enhancedResponse = [];

											for (const product of response) {
													if (product.id) {
															try {
																	const purchasePricesUrl = `${baseUrl}/api/index.php/products/${product.id}/purchase_prices`;
																	const purchasePrices = await this.helpers.request({
																			method: 'GET',
																			url: purchasePricesUrl,
																			headers,
																			json: true,
																	});

																	// Format the response if requested
																	if (additionalFields.formatResponseData) {
																			const processedData: IDataObject = {
																					"ID": product.id || '',
																					"Nom": product.label || '',
																					"Numéro de série": product.ref || '',
																					"Prix d'achat": purchasePrices?.[0]?.fourn_price || '',
																					"Fournisseur": purchasePrices?.[0]?.fourn_name || '',
																			};
																			enhancedResponse.push(processedData);
																	} else {
																			// Add purchase prices to product data
																			enhancedResponse.push({
																					...product,
																					purchase_prices: purchasePrices,
																			});
																	}
															} catch (error) {
																	// If purchase prices can't be fetched, still include the product
																	if (additionalFields.formatResponseData) {
																			const processedData: IDataObject = {
																					"ID": product.id || '',
																					"Nom": product.label || '',
																					"Numéro de série": product.serial || '',
																					"Modèle": product.computermodels_id || '',
																					"Type de produit": product.computertypes_id || '',
																					"Prix d'achat": '',
																					"Fournisseur": '',
																			};
																			enhancedResponse.push(processedData);
																	} else {
																			enhancedResponse.push({
																					...product,
																					purchase_prices: [],
																					purchase_prices_error: (error as Error).message,
																			});
																	}
															}
													} else {
															enhancedResponse.push(product);
													}
											}

											response = enhancedResponse;
									} else if (response?.id) {
											// For a single product
											try {
													const productId = response.id;
													const purchasePricesUrl = `${baseUrl}/api/index.php/products/${productId}/purchase_prices`;
													const purchasePrices = await this.helpers.request({
															method: 'GET',
															url: purchasePricesUrl,
															headers,
															json: true,
													});

													// Format the response if requested
													if (additionalFields.formatResponseData) {
															response = {
																	"ID": response.id || '',
																	"Nom": response.label || '',
																	"Numéro de série": response.serial || '',
																	"Modèle": response.computermodels_id || '',
																	"Type de produit": response.computertypes_id || '',
																	"Prix d'achat": purchasePrices?.[0]?.fourn_price || '',
																	"Fournisseur": purchasePrices?.[0]?.supplier_name || '',
															};
													} else {
															// Add purchase prices to product data
															response = {
																	...response,
																	purchase_prices: purchasePrices,
															};
													}
											} catch (error) {
													// If purchase prices can't be fetched, still include the product
													if (additionalFields.formatResponseData) {
															response = {
																	"ID": response.id || '',
																	"Nom": response.label || '',
																	"Numéro de série": response.serial || '',
																	"Modèle": response.computermodels_id || '',
																	"Type de produit": response.computertypes_id || '',
																	"Prix d'achat": '',
																	"Fournisseur": '',
															};
													} else {
															response = {
																	...response,
																	purchase_prices: [],
																	purchase_prices_error: (error as Error).message,
															};
													}
											}
									}
							}

							if (Array.isArray(response)) {
									for (const item of response) {
											const cleanedItem = cleanEmptyObjects(item);
											returnData.push({ json: filterFields(cleanedItem, fieldsToKeep) });
									}
							} else {
									const cleanedResponse = cleanEmptyObjects(response);
									returnData.push({ json: filterFields(cleanedResponse, fieldsToKeep) });
							}
					} catch (error) {
							if (this.continueOnFail()) {
									returnData.push({ json: { error: (error as Error).message } });
							} else {
									throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
							}
					}
			}

			return [returnData];
	}
}
