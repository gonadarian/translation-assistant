/**
 * This file contains functions generating suggested translations.  See the
 * jsdocs for the 'suggest' function for more details.
 */


// Matches math delimited by $, e.g.
// $x^2 + 2x + 1 = 0$
// $\text{cost} = \$4$
const MATH_REGEX = /\$(\\\$|[^\$])+\$/g;

// Matches graphie strings,
// e.g. ![](web+graphie://ka-perseus-graphie.s3.amazonaws.com/542f2b4e297910eed545a5c29c3866918655bab4)
const GRAPHIE_REGEX = /\!\[\]\([^)]+\)/g;

// Matches widget strings, e.g. [[☃ Expression 1]]
const WIDGET_REGEX = /\[\[[\u2603][^\]]+\]\]/g;

const TEXT_REGEX = /\\text{([^}]*)}/g;

// Use two line feeds to split lines because this is how Markdown delineates
// paragraphs.
const LINE_BREAK = '\n\n';


/**
 * Returns a key string for strings that should be in the same group.
 *
 * The key is used as a key for suggestionGroups.
 *
 * The key string is a JSON string that looks like:
 * '{str:"Is __MATH__ equal to __MATH__",texts:[["red", "blue"],[]]}'
 *
 * The `str` property is the `str` parameter with math, graphies, and widgets
 * replaced with placeholders.  Also, we remove unimportant whitespace
 * differences on the item so that we can group strings with similar natural
 * language text.  We also disregard bold markup when determining a match.
 * This means that translators may have to add bold markup to the suggestion
 * in some cases.
 *
 * `texts` is an array of arrays. Each entry in the outer array corresponds to
 * one `$` delineated formula in the original text. Each entry consists of all
 * of the strings within `\text{}` blocks within its corresponding formula.
 *
 * The example output above could've been generated from the following string:
 * "Is $\text{red} + \text{blue}$ equal to $7$?"
 *
 * @param {string} str The string to convert to a key.
 * @returns {string} The normalized string.
 */
function stringToGroupKey(str) {
    const maths = str.match(MATH_REGEX) || [];

    // This maps formula to an array which may contain 0 or more
    // strings which were found inside the \text{} blocks
    const texts = maths.map(math => {
        const result = [];

        allMatches(
            math, /\\text{([^}]*)}/g, matches => result.push(matches[1]));

        // The natural language text is sorted so that even if the formula is
        // different and the natural language text is in a different order
        // we'll end up with the same key.
        result.sort();

        return result;
    });

    str = str
        .replace(MATH_REGEX, '__MATH__')
        .replace(GRAPHIE_REGEX, '__GRAPHIE__')
        .replace(WIDGET_REGEX, '__WIDGET__')
        .replace(/__MATH__[\t ]*__WIDGET__/g, '__MATH__ __WIDGET__')
        .split(LINE_BREAK).map((line) => line.trim()).join(LINE_BREAK);

    return JSON.stringify({ str, texts });
}

/**
 * Returns a mapping between the order of special substrings such as math
 * strings in translatedStr and their order in englishStr.
 *
 * Example:
 * let mapping = getMapping(
 *    "simplify $2/4$\n\nhint: the denominator is $2$",
 *    "hintz: da denom $2$ iz $2$\n\nsimplifz $2/4$",
 *    "es",
 *    MATH_REGEX
 * );
 *
 * // mapping = [1,1,0];
 *
 * This mapping array indicates that the first two __MATH__ placeholders in the
 * translated string template should be replaced with the second formula
 * from the English string we're translating.  The third __MATH__ placeholder
 * should be replaced by the first formula from the English string we're
 * translating.
 *
 * @param {String} englishStr The English source string.
 * @param {String} translatedStr The translation of the englishStr.
 * @param {String} lang ka_locale of translatedStr.
 * @param {RegExp} findRegex A regex that matches math, graphies, or widgets.
 *        Use one of MATH_REGEX, GRAPHIE_REGEX, or WIDGET_REGEX.
 * @param {Object} [mathDictionary] English to translated string mapping for
 *        for strings inside \text{} blocks.
 * @returns {Array} An array representing the mapping.
 */
// TODO(kevinb): change mathDictionary to mathDictionaries
function getMapping(englishStr, translatedStr, lang, findRegex, mathDictionary) {
    let inputs = englishStr.match(findRegex) || [];
    let outputs = translatedStr.match(findRegex) || [];

    if (findRegex === MATH_REGEX) {
        inputs = inputs.map(input => {
            let result = input;
            for (const [englishText, translatedText] of Object.entries(mathDictionary)) {
                var regex = new RegExp(`\\\\text{${englishText}}`, 'g');
                var replacement = `\\text{${translatedText}}`;
                result = result.replace(regex, replacement);
            }
            return result;
        });
    }

    const mapping = [];

    outputs.forEach((output, outputIndex) => {
        if (findRegex === MATH_REGEX) {
            output = translateMath(output, lang);
        }

        const inputIndex = inputs.indexOf(output);
        if (inputIndex === -1) {
            if (findRegex === MATH_REGEX) {
                throw new Error('math doesn\'t match');
            } else if (findRegex === GRAPHIE_REGEX) {
                throw new Error('graphies don\'t match');
            } else if (findRegex === WIDGET_REGEX) {
                throw new Error('widgets don\'t match');
            } else {
                throw new Error('the only acceptable values for getFunc are ' +
                    'getMaths, getGraphies, and getWdigets');
            }
        }
        mapping[outputIndex] = inputIndex;
    });

    return mapping;
}

/**
 * Helper for getting all subgroup matches from a string.  The callback is
 * passed the matches array for each match in `text`.
 */
function allMatches(text, regex, callback) {
    let matches = regex.exec(text);
    while (matches != null) {
        callback(matches);
        matches = regex.exec(text);
    }
}

/**
 * Returns a dictionary with English strings within \text{} blocks map to
 * translated strings within \text{} blocks.
 *
 * This becomes part of the template and is used by populateTemplate to
 * automatically translate any natural language text contained with \text{}
 * blocks.
 *
 * The following call:
 * getMathDictionary(
 *     "$\text{red}$, $\text{blue} + \text{yellow}",
 *     "$\text{roja}$, $\text{azul} + \text{amarillo}"
 * );
 *
 * will return the following output:
 * {
 *     "red": "roja",
 *     "blue": "azul",
 *     "yellow": "amarillo"
 * }
 */
// TODO(kevinb): automatically handle \text{} blocks containing numbers only
function getMathDictionary(englishStr, translatedStr) {
    let inputs = englishStr.match(MATH_REGEX) || [];
    let outputs = translatedStr.match(MATH_REGEX) || [];

    const inputMap = {};
    const outputMap = {};

    inputs.forEach(input => {
        const normalized = input.replace(TEXT_REGEX, '__TEXT__');
        if (!inputMap[normalized]) {
            inputMap[normalized] = [];
        }
        inputMap[normalized].push(input);
    });

    outputs.forEach(output => {
        const normalized = output.replace(TEXT_REGEX, '__TEXT__');
        if (!outputMap[normalized]) {
            outputMap[normalized] = [];
        }
        outputMap[normalized].push(output);
    });

    const dict = {};
    Object.keys(inputMap).forEach(key => {
        if (/__TEXT__/.test(key)) {
            const input = inputMap[key];

            if (!outputMap.hasOwnProperty(key)) {
                // If outputMap is missing a key that exists in inputMap it
                // means that the math differs between the input and output
                // and getMapping will throw and error in that case.
                return;
            }
            const output = outputMap[key];

            // Compute the set of all natural language text within \text{}
            // blocks from the current English formula.
            const inputTexts = {};
            allMatches(input, /\\text{([^}]*)}/g,
                matches => inputTexts[matches[1]] = true);

            // Compute the set of all natural language text within \text{}
            // blocks from the current translated formula.
            const outputTexts = {};
            allMatches(output, /\\text{([^}]*)}/g,
                matches => outputTexts[matches[1]] = true);

            const inputKeys = Object.keys(inputTexts);
            const outputKeys = Object.keys(outputTexts);

            // We assume that the order of \text{} blocks will not change
            // within a math formula being translated.
            for (let i = 0; i < inputKeys.length; i++) {
                dict[inputKeys[i]] = outputKeys[i];
            }
        }
    });

    // contains the math dictionary
    return dict;
}

/**
 * Creates a template object based on englishStr and translatedStr strings.
 *
 * All math, graphie, and widget sub-strings are replaced by placeholders and
 * the mappings for which sub-string goes where in the translatedStr.  The
 * englishStr is split into lines.  While this isn't particular useful right
 * now, the plan is to eventually use the lines creating suggestions for
 * partial matches.
 *
 * @param {string} englishStr An English string.
 * @param {string} translatedStr The translation of the englishStr.
 * @param {string} lang The ka_locale of the translatedStr.
 * @returns {Object|Error} A template object which is passed to
 *          populateTemplate to generate suggestions for strings that haven't
 *          been translated yet.
 */
function createTemplate(englishStr, translatedStr, lang) {
    const translatedLines = translatedStr.split(LINE_BREAK);
    const mathDictionary = getMathDictionary(englishStr, translatedStr);

    try {
        return {
            lines: translatedLines.map(
                (line) => line.replace(MATH_REGEX, '__MATH__')
                    .replace(GRAPHIE_REGEX, '__GRAPHIE__')
                    .replace(WIDGET_REGEX, '__WIDGET__')),
            mathMapping:
                getMapping(englishStr, translatedStr, lang, MATH_REGEX, mathDictionary),
            graphieMapping:
                getMapping(englishStr, translatedStr, lang, GRAPHIE_REGEX),
            widgetMapping:
                getMapping(englishStr, translatedStr, lang, WIDGET_REGEX),
            mathDictionary: mathDictionary
        };
    } catch(e) {
        return e;
    }
}

/**
 * Handles any per language special case translations, e.g. Portuguese uses
 * `sen` instead of `sin`.
 *
 * @param {string} math
 * @param {string} lang
 * @returns {string}
 */
// TODO(kevinb): handle \text{} inside math
function translateMath(math, lang) {
    if (lang === 'pt') {
        return math.replace(/\\sin/g, '\\operatorname\{sen\}');
    } else {
        return math;
    }
}

/**
 * Returns a translations suggestion based the given template and englishStr.
 *
 * @param {Object} template A template object return by createTemplate.
 * @param {string} englishStr The English string to be translated.
 * @param {string} lang The ka_locale that was used when creating the template.
 * @returns {string} The suggested translation.
 */
function populateTemplate(template, englishStr, lang) {
    const englishLines = englishStr.split(LINE_BREAK);

    let maths = englishStr.match(MATH_REGEX) || [];
    const graphies = englishStr.match(GRAPHIE_REGEX) || [];
    const widgets = englishStr.match(WIDGET_REGEX) || [];

    let mathIndex = 0;
    let graphieIndex = 0;
    let widgetIndex = 0;

    maths = maths.map(math => {
        var result = translateMath(math, lang);
        var dict = template.mathDictionary;

        for (const [englishText, translatedText] of Object.entries(dict)) {
            var regex = new RegExp(`\\\\text{${englishText}}`, 'g');
            var replacement = `\\text{${translatedText}}`;
            result = result.replace(regex, replacement);
        }

        return result;
    });

    return englishLines.map((englishLine, index) => {
        const templateLine = template.lines[index];

        return templateLine.replace(/__MATH__/g, () =>
            maths[template.mathMapping[mathIndex++]]
        ).replace(/__GRAPHIE__/g, () =>
            graphies[template.graphieMapping[graphieIndex++]]
        ).replace(/__WIDGET__/g, () =>
            widgets[template.widgetMapping[widgetIndex++]]
        );
    }).join(LINE_BREAK);
}

/**
 * Provides suggestions for one or more strings from one or more groups of
 * similar strings.
 */
class TranslationAssistant {
    /**
     * Create a new TranslationAssistant instance.
     *
     * @param allItems - The items to be grouped and used to for generating
     *     suggestions, see getSuggestionGroups.
     * @param getEnglishStr - Function to extract English strings from items.
     * @param getTranslation - Function to get a translated string for an item.
     * @param lang - ka_locale, used for language specific translations, e.g.
     *     in Portuguese, `\sin` should be `\operatorname\{sen\}`.
     */
    constructor(allItems, getEnglishStr, getTranslation, lang) {
        this.getEnglishStr = getEnglishStr;
        this.getTranslation = getTranslation;
        this.suggestionGroups = this.getSuggestionGroups(allItems);
        this.lang = lang;
    }

    /**
     * Return an array of translation suggestions.
     *
     * Each item in the array is a couple with the first element being the item
     * for which the translation was generated and the second being the
     * translated string, e.g.
     *  [
     *      [
     *          {
     *              englishStr: 'foo',
     *              jiptStr: 'crowdin:1:crowdin`
     *          },
     *          'foz'
     *      ],
     *      [
     *          {
     *              englishStr: 'bar',
     *              jiptStr: 'crowdin:1:crowdin`
     *          },
     *          'baz'
     *      ]
     *  ]
     *
     * @param itemsToTranslate – same type of objects as the `allItems`
     * argument that was passed to the constructor.
     *
     * Note: the items given in the example have `englishStr` and `jiptStr`
     * properties, but they could have any shape as long as the `getEnglishStr`
     * function that was passed to the constructor returns an English string
     * when passed one of the items.
     */
    suggest(itemsToTranslate) {
        const {suggestionGroups, lang} = this;

        return itemsToTranslate.map(item => {
            const englishStr = this.getEnglishStr(item);
            const normalStr = stringToGroupKey(englishStr);
            const normalObj = JSON.parse(normalStr);

            // Translate items that are only math, a graphie, or a widget.
            // TODO(kevinb) handle multiple non-nl_text items
            if (/^(__MATH__|__GRAPHIE__|__WIDGET__)$/.test(normalObj.str)) {
                if (normalObj.str === '__MATH__') {
                    // Only translate the math if it doesn't include any
                    // natural language text in a \text command.
                    if (englishStr.indexOf('\\text') === -1) {
                        return [item, translateMath(englishStr, lang)];
                    }
                } else {
                    return [item, englishStr];
                }
            }

            if (suggestionGroups.hasOwnProperty(normalStr)) {
                const {template} = suggestionGroups[normalStr];

                // This error is probably due to math being different between
                // the English string and the translated string.
                if (template instanceof Error) {
                    return [item, null];
                }

                if (template) {
                    const translatedStr = populateTemplate(
                        template, this.getEnglishStr(item), lang);
                    return [item, translatedStr];
                }
            }

            // The item doesn't belong in any of the suggestion groups.
            return [item, null];
        });
    }

    /**
     * Group objects that contain English strings to translate.
     *
     * Groups are determined by the similarity between the English strings
     * returned by `this.getEnglishStr` on each object in `items`.  In order to
     * find more matches we ignore math, graphie, and widget substrings.
     *
     * Each group contains an array of items that belong in that group and a
     * translation template if there was at least one item that had a
     * translation.  Translations are determined by passing each item to
     * `this.getTranslation`.
     *
     * Input:
     * [
     *    {
     *        englishStr: "simplify $2/4$",
     *        id: 1001,
     *    }, {
     *        englishStr: "simplify $3/12$",
     *        id: 1002,
     *    }
     * ];
     *
     * Output:
     * {
     *    '{str:"simplify __MATH__",text:[[]]}': {
     *        items: [{
     *            englishStr: "simplify $2/4$",
     *            id: 1001,
     *        }, {
     *            englishStr: "simplify $3/12$",
     *            id: 1002,
     *        }],
     *        template: { ... }
     *    },
     *    ...
     * }
     */
    getSuggestionGroups(items) {
        const suggestionGroups = {};

        items.forEach(obj => {
            var key = stringToGroupKey(this.getEnglishStr(obj));

            if (suggestionGroups[key]) {
                suggestionGroups[key].push(obj);
            } else {
                suggestionGroups[key] = [obj];
            }
        });

        Object.keys(suggestionGroups).forEach(key => {
            const items = suggestionGroups[key];

            for (const item of items) {
                const englishStr = this.getEnglishStr(item);
                const translatedStr = this.getTranslation(item);

                if (translatedStr) {
                    const template =
                        createTemplate(englishStr, translatedStr, this.lang);
                    suggestionGroups[key] = {items, template};
                    return;
                }
            }
            suggestionGroups[key] = {items, template: null};
        });

        return suggestionGroups;
    }
}

TranslationAssistant.stringToGroupKey = stringToGroupKey;
TranslationAssistant.createTemplate = createTemplate;
TranslationAssistant.populateTemplate = populateTemplate;

module.exports = TranslationAssistant;
