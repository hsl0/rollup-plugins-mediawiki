"use strict";
/// <reference types="types-mediawiki" />
function rel2abs(title, location = mw.config.get('wgPageName')) {
    const parts = title.split('/');
    switch (parts[0]) {
        case '':
        case '.':
            parts.shift();
        case '..':
            parts.unshift(...location.split('/'));
    }
    for (let i = 0; i < parts.length;) {
        if (parts[i] === '..')
            parts.splice(--i, 2);
        else if (parts[i] === '.')
            parts.splice(i, 1);
        else
            i++;
    }
    return parts.join('/');
}
function createModuleTransformer(mappings) {
    return (name) => {
        if (/^\//.test(name))
            return name; // / => url
        if (/^\.\.?(\/|$)/.test(name))
            // ../
            return mappings.wiki(name, mw.config.get('wgPageName'));
        if (/^[^\/#:]*:/.test(name))
            return Object.keys(mw.config.get('wgNamespaceIds')).includes(name.replaceAll(' ', '_').split('/')[0].toLowerCase()) // namespace:
                ? mappings.wiki(name, mw.config.get('wgPageName'))
                : name;
        if (/^@?[a-z-._\/]+/.test(name))
            return mappings.loader(name);
        throw new TypeError(`'${name}' is not valid js module`);
    };
}
// createModuleTransformer({
// 	wiki: rel2abs,
// });
//# sourceMappingURL=main.js.map