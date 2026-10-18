// Keep links portable when GitHub Pages or a fork supplies a different base path.
export default function remarkLinks({ defaultBase, base }) {
  const prefix = base === '/' ? '' : base.replace(/\/$/, '');
  return (tree) => {
    function visit(node) {
      if ((node.type === 'link' || node.type === 'image') && node.url.startsWith(defaultBase + '/')) {
        node.url = prefix + node.url.slice(defaultBase.length);
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}
