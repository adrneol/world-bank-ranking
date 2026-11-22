/** One catalog supplies machine descriptors and server-readable example links. */
export function bindCatalog(catalog,apiOrigin) {
  return {...catalog,apiOrigin,operations:(catalog.operations??[]).map(operation=>({...operation,
    parameters:operation.parameters.map(parameter=>({...parameter,definition:catalog.parameterDefinitions[parameter.name]})),
    url:apiOrigin+operation.path,examples:operation.examples.map(example=>({...example,
      url:apiOrigin+operation.path+(Object.keys(example.parameters).length?'?'+new URLSearchParams(example.parameters):'')}))}))};
}
