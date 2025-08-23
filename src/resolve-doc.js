function reviveNode(node) {
  if (!node || typeof node !== 'object') return node;

  if (node.layout?.type === 'noteLayout') {
    node.layout = {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => 'black',
      vLineColor: () => 'black',
    };
  }

  if (Array.isArray(node.stack)) node.stack = node.stack.map(reviveNode);
  if (Array.isArray(node.columns)) node.columns = node.columns.map(reviveNode);
  if (node.table?.body)
    node.table.body = node.table.body.map((r) => r.map(reviveNode));
  return node;
}

export async function resolveDocDefinition(docDefinition) {
  if (!docDefinition || typeof docDefinition !== 'object') return docDefinition;

  if (docDefinition.background?.type === 'border') {
    docDefinition.background = function (_currentPage, pageSize) {
      return {
        canvas: [
          {
            type: 'rect',
            x: 0,
            y: 0,
            w: pageSize.width,
            h: pageSize.height,
            lineWidth: 15,
            lineColor: '#002060',
          },
        ],
      };
    };
  }

  if (docDefinition.header?.type === 'header') {
    const headerData = docDefinition.header.data;
    const { buildHeader } = await import('./builders/build-header.js');
    docDefinition.header = () => buildHeader(headerData);
  }

  if (docDefinition.footer?.type === 'footer') {
    const { buildFooter } = await import('./builders/builder-footer.js');
    docDefinition.footer = (currentPage, pageCount) =>
      buildFooter(currentPage, pageCount);
  }

  if (docDefinition.content) {
    docDefinition.content = Array.isArray(docDefinition.content)
      ? docDefinition.content.map(reviveNode)
      : reviveNode(docDefinition.content);
  }

  return docDefinition;
}
