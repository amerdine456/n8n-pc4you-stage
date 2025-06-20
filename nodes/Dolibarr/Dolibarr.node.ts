import {
    IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, NodeOperationError, IHttpRequestMethods,		NodeConnectionType,
} from 'n8n-workflow';

import {
    cleanEmptyObjects, filterFields, IAdditionalFields, IFilter
} from './DolibarrUtils';

export class Dolibarr implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Dolibarr',
        name: 'dolibarr',
        icon: 'file:dolibarr.svg',
        group: ['input'],
        version: 1,
        subtitle: '={{$parameter["operation"]}}',
        description: 'Interact with Dolibarr API',
        defaults: {
            name: 'Dolibarr',
        },
			 // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
				inputs: ['main' as NodeConnectionType],
				// eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
				outputs: ['main' as NodeConnectionType],
        credentials: [
            {
                name: 'dolibarrApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Get Customer Invoices',
                        value: 'getCustomerInvoices',
                        description: 'Retrieve customer invoices (factures clients)',
                        action: 'Retrieve customer invoices factures clients',
                    },
                    {
                        name: 'Get Products',
                        value: 'getProducts',
                        description: 'Retrieve products',
                        action: 'Retrieve products',
                    },
                    {
                        name: 'Get Supplier Invoices',
                        value: 'getSupplierInvoices',
                        description: 'Retrieve supplier invoices (factures fournisseurs)',
                        action: 'Retrieve supplier invoices factures fournisseurs',
                    },
                    {
                        name: 'Get Supplier Orders',
                        value: 'getSupplierOrders',
                        description: 'Retrieve supplier orders (commandes fournisseurs)',
                        action: 'Retrieve supplier orders commandes fournisseurs',
                    },
                    {
                        name: 'Get Thirdparties',
                        value: 'getThirdparties',
                        description: 'Retrieve thirdparties',
                        action: 'Retrieve thirdparties',
                    },
                    {
                        name: 'Post Supplier Orders',
                        value: 'postSupplierOrders',
                        description: 'Post supplier orders (commandes fournisseurs)',
                        action: 'Post supplier orders commandes fournisseurs',
                    },
                ],
                default: 'getCustomerInvoices',
            },
            {
                displayName: 'Status',
                name: 'status',
                type: 'options',
                options: [
                    {
                        name: 'Brouillon',
                        value: 'draft',
                    },
                    {
                        name: 'Impayé',
                        value: 'unpaid',
                    },
                    {
                        name: 'Payé',
                        value: 'paid',
                    },
                    {
                        name: 'Abandonnée',
                        value: 'cancelled',
                    },
                ],
                default: 'unpaid',
                description: 'Filter invoices by status',
                displayOptions: {
                    show: {
                        operation: ['getCustomerInvoices', 'getSupplierInvoices'],
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
                options: [
                    {
                        displayName: 'Fields',
                        name: 'fields',
                        values: [
                            {
                                displayName: 'Field Name',
                                name: 'field',
                                type: 'string',
                                placeholder: 'Name of the field to keep (e.g., ID, ref, label)',
                                default: '',
                            },
                        ],
                    },
                ],
                displayOptions: {
                    show: {
                        operation: ['getCustomerInvoices', 'getSupplierInvoices', 'getSupplierOrders', 'getThirdparties', 'getProducts'],
                    },
                },
            },
            {
                displayName: 'Additional Fields',
                name: 'additionalFields',
                type: 'collection',
                placeholder: 'Add Parameter',
                default: {},
                displayOptions: {
                    show: {
                        operation: ['getCustomerInvoices', 'getSupplierInvoices', 'getSupplierOrders', 'getThirdparties', 'getProducts'],
                    },
                },
                options: [
                    {
                        displayName: 'Filters',
                        name: 'filters',
                        type: 'fixedCollection',
                        placeholder: 'Add Filter',
                        typeOptions: { multipleValues: false },
                        default: {},
                        description: 'Filters to apply at API level using SQL filters',
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
                                        placeholder: 'Name of the field to filter (e.g., status, ref, label)',
                                    },
                                    {
                                        displayName: 'Value',
                                        name: 'filterValue',
                                        type: 'string',
                                        default: '',
                                        placeholder: 'Value to filter for',
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        displayName: 'ID',
                        name: 'id',
                        type: 'number',
                        default: '',
                        placeholder: 'ID of the specific resource.',
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
                                placeholder: "Field name to sort by"
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
            {
                displayName: 'Return All Results',
                name: 'returnAll',
                type: 'boolean',
                default: false,
                description: 'Whether to return all results or only up to a given limit',
                displayOptions: {
                    show: {
                        operation: ['getCustomerInvoices', 'getSupplierInvoices', 'getSupplierOrders', 'getThirdparties', 'getProducts'],
                    },
                },
            },
            {
                displayName: 'Limit',
                name: 'limit',
                type: 'number',
                default: 50,
                typeOptions: { minValue: 1 },
                description: 'Max number of results to return',
                displayOptions: {
                    hide: {
                        returnAll: [true],
                    },
                    show: {
                        operation: ['getCustomerInvoices', 'getSupplierInvoices', 'getSupplierOrders', 'getThirdparties', 'getProducts'],
                    },
                },
            },
            {
                displayName: 'Nom Fournisseurs',
                name: 'nomFournisseurs',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'Nom du fournisseur à rechercher',
                displayOptions: {
                    show: {
                        operation: ['postSupplierOrders'],
                    },
                },
            },
            {
                displayName: 'Ref Fournisseurs',
                name: 'ref_supplier',
                type: 'string',
                default: '',
                placeholder: 'Référence du fournisseur',
                displayOptions: {
                    show: {
                        operation: ['postSupplierOrders'],
                    },
                },
            },
            {
                displayName: 'Products Data',
                name: 'productsData',
                type: 'string',
                default: '',
                placeholder: 'Can accept JSON array of products (fk_product is prioritised over desc)',
                description: 'EX: {"products":[{"desc": "Product Name or Description","qty": 5,"product_type": 0,"tva_tx": 20,"subprice": 15.50,"fk_product": 123},{"desc": "Another Product","qty": 2,"product_type": 0,"tva_tx": 10,"subprice": 25.00}]}',
                displayOptions: {
                    show: {
                        operation: ['postSupplierOrders'],
                    },
                },
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const operation = this.getNodeParameter('operation', 0) as string;

        const operationToResource: Record<string, string> = {
            getCustomerInvoices: 'invoices',
            getProducts: 'products',
            getSupplierInvoices: 'supplierinvoices',
            getSupplierOrders: 'supplierorders',
            getThirdparties: 'thirdparties',
            postSupplierOrders: 'supplierorders',
        };

        const resource = operationToResource[operation] || 'invoices';

        if (operation === 'postSupplierOrders') {
            const credentials = await this.getCredentials('dolibarrApi');
            const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');
            const apiKey = credentials.apiKey as string;

            const returnData: INodeExecutionData[] = [];
            const headers = { 'DOLAPIKEY': apiKey, 'Content-Type': 'application/json' };

            for (let i = 0; i < items.length; i++) {
                try {
                    const nomFournisseur = this.getNodeParameter('nomFournisseurs', i) as string;
                    const refSupplier = this.getNodeParameter('ref_supplier', i) as string;
                    const productsData = this.getNodeParameter('productsData', i, '') as string;
                    let socid: number | null = null;

                    // Find supplier ID
                    if (nomFournisseur && nomFournisseur.trim()) {
                        const nomFournisseurTrimmed = nomFournisseur.trim();
                        if (/^\d+$/.test(nomFournisseurTrimmed)) {
                            socid = parseInt(nomFournisseurTrimmed, 10);
                        } else {
                            // const firstLetter = nomFournisseurTrimmed.charAt(0).toLowerCase();
                            let page = 0;
                            const pageSize = 100;
                            let found = false;

                            while (!found) {
                                const sqlFilter = `(t.nom:like:'${nomFournisseurTrimmed}%')`;
                                const encodedSqlFilter = encodeURIComponent(sqlFilter);
                                const thirdpartiesUrl = `${baseUrl}/api/index.php/thirdparties?page=${page}&limit=${pageSize}&sqlfilters=${encodedSqlFilter}`;

                                try {
                                    const thirdpartiesResponse = await this.helpers.request({
                                        method: 'GET' as IHttpRequestMethods,
                                        url: thirdpartiesUrl,
                                        headers,
                                        json: true,
                                    });

                                    let suppliers: any[] = Array.isArray(thirdpartiesResponse) ? thirdpartiesResponse : [thirdpartiesResponse];
                                    const matchingSuppliers = suppliers.filter((s: any) => s.name && s.name.toLowerCase() === nomFournisseur.toLowerCase());

                                    if (matchingSuppliers.length === 0) {
                                        if (suppliers.length < pageSize) {
                                            throw new NodeOperationError(this.getNode(), `Supplier with name "${nomFournisseur}" not found`, { itemIndex: i });
                                        } else {
                                            page++;
                                        }
                                    } else if (matchingSuppliers.length > 1) {
                                        const supplierNames = matchingSuppliers.map(s => `${s.nom} (ID: ${s.id})`).join(', ');
                                        throw new NodeOperationError(this.getNode(), `Multiple suppliers found with name "${nomFournisseur}": ${supplierNames}. Please be more specific.`, { itemIndex: i });
                                    } else {
                                        socid = matchingSuppliers[0].id;
                                        found = true;
                                    }
                                } catch (error) {
                                    throw new NodeOperationError(this.getNode(), `Failed to find supplier: ${(error as Error).message}`, { itemIndex: i });
                                }
                            }
                        }
                    } else {
                        throw new NodeOperationError(this.getNode(), 'Nom Fournisseur is required', { itemIndex: i });
                    }

                    // Parse products data
										let productsArray: any[] = [];

										// First, try to get products from the input item's JSON data
										if (items[i].json && typeof items[i].json === 'object') {
												const inputData = items[i].json;

												// Check if there's a products array in the input data
												if (inputData.products && Array.isArray(inputData.products)) {
														productsArray = inputData.products;
												}
												// Check if there are individual product fields
												else if (inputData.product_name || inputData.description || inputData.desc) {
														productsArray = [{
																desc: inputData.product_name || inputData.description || inputData.desc,
																qty: inputData.quantity || inputData.qty || 1,
																product_type: inputData.product_type || 0,
																tva_tx: inputData.tva_tx || inputData.tax_rate || 20,
																subprice: inputData.subprice || inputData.unit_price || inputData.price || 0,
																fk_product: inputData.fk_product || inputData.product_id
														}];
												}
												// Check for multiple products in a structured way (like from a parsed PDF or CSV)
												else {
														// Look for numbered product fields (product1_name, product2_name, etc.)
														const productNumbers = new Set<number>();
														Object.keys(inputData).forEach(key => {
																const match = key.match(/^product(\d+)_/);
																if (match) {
																		productNumbers.add(parseInt(match[1]));
																}
														});

														if (productNumbers.size > 0) {
																Array.from(productNumbers).sort().forEach(num => {
																		const product: any = {
																				desc: inputData[`product${num}_name`] || inputData[`product${num}_desc`] || '',
																				qty: inputData[`product${num}_qty`] || inputData[`product${num}_quantity`] || 1,
																				product_type: inputData[`product${num}_type`] || 0,
																				tva_tx: inputData[`product${num}_tva`] || inputData[`product${num}_tax`] || 20,
																				subprice: inputData[`product${num}_price`] || inputData[`product${num}_subprice`] || 0
																		};

																		if (inputData[`product${num}_id`] || inputData[`product${num}_fk_product`]) {
																				product.fk_product = inputData[`product${num}_id`] || inputData[`product${num}_fk_product`];
																		}

																		if (product.desc || product.fk_product) {
																				productsArray.push(product);
																		}
																});
														}
												}
										}

										if (productsArray.length === 0 && productsData) {
												let productsDataStr = typeof productsData === 'string' ? productsData : JSON.stringify(productsData);

												if (productsDataStr.trim()) {
														try {
																// Try to parse as JSON first
																const parsed = JSON.parse(productsDataStr);

																// Check if parsed data is already an array of products
																if (Array.isArray(parsed)) {
																		productsArray = parsed.map(product => ({
																				desc: product.desc || product.libelle || product.product_label || '',
																				qty: product.qty || 1,
																				product_type: product.product_type || 0,
																				tva_tx: product.tva_tx || 20,
																				subprice: product.subprice || product.pu_ht || 0,
																				fk_product: product.fk_product || 0
																		}));
																} else if (typeof parsed === 'object') {
																		// If it's a single product object, wrap it in an array
																		productsArray = [{
																				desc: parsed.desc || parsed.libelle || parsed.product_label || '',
																				qty: parsed.qty || 1,
																				product_type: parsed.product_type || 0,
																				tva_tx: parsed.tva_tx || 20,
																				subprice: parsed.subprice || parsed.pu_ht || 0,
																				fk_product: parsed.fk_product || 0
																		}];
																}
														} catch (jsonError) {
																// Throw an error if parsing fails
                                                                throw new NodeOperationError(this.getNode(), `Failed to parse productsData: ${jsonError}`, { itemIndex: i });
														}
												}
										}


										// Validate that products array is not empty or contains only empty objects
										const isValidProduct = (product: any): boolean => {
												if (!product || typeof product !== 'object') return false;

												// Check if product has at least one meaningful property
												const hasDesc = product.desc && product.desc.toString().trim();
												const hasFkProduct = product.fk_product && (typeof product.fk_product === 'number' || product.fk_product.toString().trim());
												const hasProductName = product.product_name && product.product_name.toString().trim();
												const hasDescription = product.description && product.description.toString().trim();

												return hasDesc || hasFkProduct || hasProductName || hasDescription;
										};

										// Filter out empty products
										const validProducts = productsArray.filter(isValidProduct);

										if (validProducts.length === 0) {
												// Return success response but indicate no products to process
												returnData.push({
														json: {
																success: true,
																message: 'No valid products found to create supplier order. Operation skipped.',
																supplier: {
																		name: nomFournisseur,
																		id: socid || 'Not found',
																},
																products_provided: productsArray.length,
																valid_products: 0,
																operation: operation,
																resource: resource,
																skipped: true
														},
												});
												continue; // Skip to next item
										}

                    // Function to search for a product by description
										const findProductByDescription = async (productDesc: string): Promise<number | null> => {
												// const firstLetter = productDesc.charAt(0).toLowerCase();
												let page = 0;
												const pageSize = 100;
												let foundProductId: number | null = null;

												while (!foundProductId) {
														const sqlFilter = `(t.label:like:'%${productDesc}%')`;
														const encodedSqlFilter = encodeURIComponent(sqlFilter);
														const productsUrl = `${baseUrl}/api/index.php/products?page=${page}&limit=${pageSize}&sqlfilters=${encodedSqlFilter}`;

														try {
																const productsResponse = await this.helpers.request({
																		method: 'GET' as IHttpRequestMethods,
																		url: productsUrl,
																		headers,
																		json: true,
																});

																let products: any[] = Array.isArray(productsResponse) ? productsResponse : [productsResponse];
																const matchingProducts = products.filter((p: any) => p.label && p.label.toLowerCase().includes(productDesc.toLowerCase()));

																if (matchingProducts.length === 0) {
																		if (products.length < pageSize) {
																				break;
																		} else {
																				page++;
																		}
																} else if (matchingProducts.length > 1) {
																		const productLabels = matchingProducts.map(p => `${p.label} (ID: ${p.id})`).join(', ');
																		throw new NodeOperationError(this.getNode(), `Multiple products found with description "${productDesc}": ${productLabels}. Please be more specific.`, { itemIndex: i });
																} else {
																		foundProductId = matchingProducts[0].id;
																}
														} catch (error) {
																// If the error is a 404, it means no product was found, so we return null
																if ((error as any).error?.code === 404) {
																		return null;
																}
																throw new NodeOperationError(this.getNode(), `Failed to find product: ${(error as Error).message}`, { itemIndex: i });
														}
												}

												return foundProductId;
										};

										// Build order lines from products array
										const orderLines = [];
										for (const product of validProducts) {
												const orderLine: any = {
														qty: product.qty || 1,
														product_type: product.product_type || 0,
														tva_tx: product.tva_tx || 20,
														subprice: product.subprice || 0,
												};

												if (product.fk_product) {
														orderLine.fk_product = product.fk_product;
												} else if (product.desc && product.desc.trim()) {
														const productDesc = product.desc.trim();
														try {
																const productId = await findProductByDescription(productDesc);
																if (productId) {
																		orderLine.fk_product = productId;
																} else {
																		orderLine.desc = productDesc;
																}
														} catch (error) {
																// If there's an error finding the product, use the description directly
																orderLine.desc = productDesc;
														}
												} else {
														continue; // Skip products without either ID or description
												}

												orderLines.push(orderLine);
										}

                    if (orderLines.length === 0) {
                        throw new NodeOperationError(this.getNode(), 'No valid product lines could be created from the provided data.', { itemIndex: i });
                    }

                    const orderData = {
                        ref: "auto",
                        ref_supplier: refSupplier,
                        socid: socid,
                        lines: orderLines,
                    };

                    const createOrderUrl = `${baseUrl}/api/index.php/supplierorders`;
                    const createOrderResponse = await this.helpers.request({
                        method: 'POST' as IHttpRequestMethods,
                        url: createOrderUrl,
                        headers,
                        json: true,
                        body: orderData,
                    });

                    let createdOrderId: number | null = null;

                    if (createOrderResponse && typeof createOrderResponse === 'object') {
                        if (createOrderResponse.id) {
                            createdOrderId = createOrderResponse.id;
                        } else if (typeof createOrderResponse === 'number') {
                            createdOrderId = createOrderResponse;
                        }
                    }

                    if (!createdOrderId) {
                        const getOrdersUrl = `${baseUrl}/api/index.php/supplierorders`;

                        try {
                            const ordersResponse = await this.helpers.request({
                                method: 'GET' as IHttpRequestMethods,
                                url: getOrdersUrl,
                                headers,
                                json: true,
                            });

                            let orders: any[] = Array.isArray(ordersResponse) ? ordersResponse : [ordersResponse];
                            const matchingOrder = orders
                                .filter((order: any) =>
                                    order.ref_supplier === refSupplier &&
                                    order.socid === socid
                                )
                                .sort((a: any, b: any) => (b.id || 0) - (a.id || 0))[0];

                            if (matchingOrder && matchingOrder.id) {
                                createdOrderId = matchingOrder.id;
                            }
                        } catch (error) {
                            console.log('Failed to fetch orders to find created order ID:', error);
                        }
                    }

                    const orderDetails: any = {
                        id: createOrderResponse,
                        ref: createOrderResponse?.ref || 'auto',
                        ref_supplier: refSupplier,
                        socid: nomFournisseur,
                        lines: orderLines,
                        products_count: orderLines.length,
                    };

                    returnData.push({
                        json: {
                            success: true,
                            message: `Supplier order created successfully with ${orderLines.length} product(s)`,
                            supplier: {
                                name: nomFournisseur,
                                id: socid,
                            },
                            order: orderDetails,
                            createOrderResponse: "PROV" + createOrderResponse,
                            operation: operation,
                            resource: resource,
                        },
                    });

                } catch (error) {
                    if (this.continueOnFail()) {
                        returnData.push({
                            json: {
                                success: false,
                                error: (error as Error).message,
                                operation: operation,
                                resource: resource,
                            },
                        });
                    } else {
                        throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
                    }
                }
            }

            return [returnData];
        }

        // Rest of the existing GET operations code remains the same...
        const returnAll = this.getNodeParameter('returnAll', 0) as boolean;
        const limit = returnAll ? undefined : this.getNodeParameter('limit', 0) as number;

        const credentials = await this.getCredentials('dolibarrApi');
        const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');
        const apiKey = credentials.apiKey as string;

        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                const headers = { 'DOLAPIKEY': apiKey };

                const filterCollection = this.getNodeParameter('filterFields', i, {}) as { fields?: { field: string }[] };
                const fieldsToKeep = (filterCollection.fields || []).map(f => f.field).filter(f => !!f);

                const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IAdditionalFields & {
                    fetchPurchasePrices?: boolean;
                    formatResponseData?: boolean;
                    filters?: {
                        filters?: Array<{
                            filterField: string;
                            filterValue: string;
                        }>;
                    };
                    status?: string;
                };

                const { id } = additionalFields;

                let response: any[] = [];

                if (id) {
                    const url = `${baseUrl}/api/index.php/${resource}/${id}`;
                    const singleResponse = await this.helpers.request({
                        method: 'GET' as IHttpRequestMethods,
                        url,
                        headers,
                        json: true,
                    });
                    response = [singleResponse];
                } else {
                    const filters = additionalFields.filters;
                    let filtersArray: IFilter[] = [];

                    if (filters && filters.filters) {
                        if (Array.isArray(filters.filters)) {
                            filtersArray = filters.filters;
                        } else if (typeof filters.filters === 'object' && filters.filters !== null) {
                            filtersArray = [filters.filters];
                        }
                    } else if (Array.isArray(filters)) {
                        filtersArray = filters;
                    }

                    const sqlFilters: string[] = [];

                    for (const filter of filtersArray as IFilter[]) {
                        const field = filter.filterField;
                        const value = filter.filterValue;

                        if (!field || !field.trim() || value === undefined || value === null) {
                            continue;
                        }

                        const stringValue = String(value).trim();
                        if (!stringValue) continue;

                        const sqlCondition = `(t.${field}:like:'%${stringValue}%')`;
                        sqlFilters.push(sqlCondition);
                    }

                    let sqlFilterParam = '';
                    const combinedSqlFilter = sqlFilters.join(' AND ');
                    sqlFilterParam = encodeURIComponent(combinedSqlFilter);

                    let page = 0;
                    const pageSize = 500;
                    const maxItems = returnAll ? Infinity : (limit ?? 50);
                    const seenIds = new Set<string | number>();
                    let consecutiveEmptyPages = 0;
                    const maxConsecutiveEmptyPages = 2;

                    const fetchPagesInParallel = async (pages: number[]) => {
                        const fetchPromises = pages.map(async (pageNum) => {
                            let url = `${baseUrl}/api/index.php/${resource}?page=${pageNum}&limit=${pageSize}`;

                            if (operation === 'getCustomerInvoices' || operation === 'getSupplierInvoices') {
																const status = this.getNodeParameter('status', i, undefined) as string | undefined;
																if (status) {
																		url += `&status=${status}`;
																}
														}

                            if (sqlFilterParam) {
                                url += `&sqlfilters=${sqlFilterParam}`;
                            }

                            try {
                                const pageResponse = await this.helpers.request({
                                    method: 'GET' as IHttpRequestMethods,
                                    url,
                                    headers,
                                    json: true,
                                });

                                let itemsInResponse: any[] = [];
                                if (Array.isArray(pageResponse)) {
                                    itemsInResponse = pageResponse;
                                } else if (pageResponse && typeof pageResponse === 'object') {
                                    if (pageResponse.data && Array.isArray(pageResponse.data)) {
                                        itemsInResponse = pageResponse.data;
                                    } else {
                                        itemsInResponse = [pageResponse];
                                    }
                                }

                                return itemsInResponse;
                            } catch (error) {
                                return [];
                            }
                        });

                        return Promise.all(fetchPromises);
                    };

                    while (response.length < maxItems && consecutiveEmptyPages < maxConsecutiveEmptyPages) {
                        const pagesToFetch = Array.from({ length: 5 }, (_, index) => page + index);
                        const pagesResponses = await fetchPagesInParallel(pagesToFetch);

                        let hasData = false;
                        for (const itemsInResponse of pagesResponses) {
                            if (itemsInResponse.length === 0) {
                                consecutiveEmptyPages++;
                                continue;
                            }

                            consecutiveEmptyPages = 0;
                            hasData = true;

                            const newItems = [];
                            for (const item of itemsInResponse) {
                                const itemId = item?.id;
                                if (itemId !== undefined && itemId !== null && !seenIds.has(itemId)) {
                                    seenIds.add(itemId);
                                    newItems.push(item);
                                }
                            }

                            if (newItems.length > 0) {
                                const remainingSlots = maxItems - response.length;
                                const itemsToAdd = returnAll ?
                                    newItems :
                                    newItems.slice(0, Math.max(0, remainingSlots));

                                response.push(...itemsToAdd);
                            }

                            if (itemsInResponse.length < pageSize) {
                                consecutiveEmptyPages = Math.max(0, maxConsecutiveEmptyPages - 1);
                            }
                        }

                        if (!hasData) {
                            consecutiveEmptyPages++;
                        }

                        page += pagesToFetch.length;
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
