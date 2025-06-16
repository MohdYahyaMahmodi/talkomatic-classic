const fs = require('fs');

class TrieNode {
    constructor() {
        this.children = {};
        this.isEndOfWord = false;
    }
}

class Trie {
    constructor() {
        this.root = new TrieNode();
    }

    insert(word) {
        let node = this.root;
        for (let char of word) {
            if (!node.children[char]) {
                node.children[char] = new TrieNode();
            }
            node = node.children[char];
        }
        node.isEndOfWord = true;
    }

    search(word) {
        let node = this.root;
        for (let char of word) {
            if (!node.children[char]) {
                return false;
            }
            node = node.children[char];
        }
        return node.isEndOfWord;
    }
}

class WordFilter {
    constructor(wordsFilePath) {
        try {
            const data = JSON.parse(fs.readFileSync(wordsFilePath, 'utf8'));

            if (!Array.isArray(data.offensive_words) || !Array.isArray(data.whitelisted_words)) {
                throw new Error('Invalid JSON structure: offensive_words and whitelisted_words must be arrays');
            }

            this.offensiveTrie = new Trie();
            data.offensive_words.forEach(word => this.offensiveTrie.insert(word.toLowerCase()));

            this.whitelistTrie = new Trie();
            data.whitelisted_words.forEach(word => this.whitelistTrie.insert(word.toLowerCase()));

            console.log(`Loaded ${data.offensive_words.length} offensive words and ${data.whitelisted_words.length} whitelisted words`);

            this.cache = new Map();
            this.cacheSize = 1000;
            this.cacheHits = 0;
            this.cacheMisses = 0;

            // Add obfuscation mapping
            this.obfuscationMap = {'@':'a','4':'a','/-\':'a','∂':'a','α':'a','а':'a','á':'a','à':'a','â':'a','ä':'a','ã':'a','å':'a','ā':'a','ą':'a','ă':'a','8':'b','13':'b','|3':'b','ß':'b','в':'b','б':'b','(':'','<':'','¢':'c','©':'c','с':'c','ç':'c','|)':'d','cl':'d','đ':'d','ð':'d','3':'e','&':'e','€':'e','ë':'e','е':'e','è':'e','é':'e','ê':'e','ē':'e','ė':'e','ε':'e','6':'g','9':'g','ğ':'g','#':'h','|-|':'h',']-[':'h','}-{':'h','н':'h','!':'i','1':'l','|':'i','í':'i','ì':'i','î':'i','ï':'i','ī':'i','ı':'i','_|':'j','_)':'j','¿':'j','|<':'k','|{':'k','|(':'k','κ':'k','к':'k','ķ':'k','|_':'l','£':'e','ℓ':'l','ļ':'l','|\/|':'m','/\/\':'m','|v|':'m','м':'m','/\/':'n','|\|':'n','^/':'n','п':'n','ñ':'n','ń':'n','η':'n','л':'n','0':'o','()':'o','[]':'o','<>':'o','о':'o','ö':'o','ó':'o','ò':'o','ô':'o','õ':'o','ø':'o','ō':'o','|D':'p','|*':'p','|º':'p','р':'p','þ':'p','0_':'q','(,)':'q','φ':'q','|2':'r','®':'r','Я':'r','я':'r','5':'s','$':'s','§':'s','ś':'s','š':'s','ș':'s','ѕ':'s','7':'t','+':'t','†':'t','`|`':'t','т':'t','|_|':'u','µ':'u','ü':'u','ú':'u','ù':'u','û':'u','ū':'u','\/':'v','\|':'v','ν':'v','\/\/':'w','vv':'w','\^/':'w','ω':'w','><':'x','}{':'x','×':'x','χ':'x','ж':'x','`/':'y','¥':'y','у':'y','ý':'y','ÿ':'y','2':'z','≥':'z','ž':'z','ź':'z','ż':'z','™':'tm','%':'x','^':'v','*':'',')':'','-':'','_':'','=':'','[':'',']':'','{':'','}':'',';':'',':':'',''':'','"':'',',':'','.':'','>':'','/':'','?':'','\':'','`':'','~':'','і':'i','х':'x','β':'b','γ':'y','δ':'d','ι':'i','ο':'o','ρ':'p','τ':'t','υ':'u','ɑ':'a','⍺':'a','ａ':'a','𝐚':'a','𝑎':'a','𝒂':'a','𝒶':'a','𝓪':'a','𝔞':'a','𝕒':'a','𝖆':'a','𝖺':'a','𝗮':'a','𝘢':'a','𝙖':'a','𝚊':'a','𝛂':'a','𝛼':'a','𝜶':'a','𝝰':'a','𝞪':'a','Ƅ':'b','Ь':'b','Ꮟ':'b','ᑲ':'b','ᖯ':'b','ｂ':'b','𝐛':'b','𝑏':'b','𝒃':'b','𝒷':'b','𝓫':'b','𝔟':'b','𝕓':'b','𝖇':'b','𝖻':'b','𝗯':'b','𝘣':'b','𝙗':'b','𝚋':'b','ϲ':'c','ᴄ':'c','ⅽ':'c','ⲥ':'c','ꮯ':'c','ｃ':'c','𐐽':'c','𝐜':'c','𝑐':'c','𝒄':'c','𝒸':'c','𝓬':'c','𝔠':'c','𝕔':'c','𝖈':'c','𝖼':'c','𝗰':'c','𝘤':'c','𝙘':'c','𝚌':'c','ԁ':'d','Ꮷ':'d','ᑯ':'d','ⅆ':'d','ⅾ':'d','ꓒ':'d','ｄ':'d','𝐝':'d','𝑑':'d','𝒅':'d','𝒹':'d','𝓭':'d','𝔡':'d','𝕕':'d','𝖉':'d','𝖽':'d','𝗱':'d','𝘥':'d','𝙙':'d','𝚍':'d','ҽ':'e','℮':'e','ℯ':'e','ⅇ':'e','ꬲ':'e','ｅ':'e','𝐞':'e','𝑒':'e','𝒆':'e','𝓮':'e','𝔢':'e','𝕖':'e','𝖊':'e','𝖾':'e','𝗲':'e','𝘦':'e','𝙚':'e','𝚎':'e','ſ':'f','ϝ':'f','ք':'f','ẝ':'f','ꞙ':'f','ꬵ':'f','ｆ':'f','𝐟':'f','𝑓':'f','𝒇':'f','𝒻':'f','𝓯':'f','𝔣':'f','𝕗':'f','𝖋':'f','𝖿':'f','𝗳':'f','𝘧':'f','𝙛':'f','𝚏':'f','𝟋':'f','ƍ':'g','ɡ':'g','ց':'g','ᶃ':'g','ℊ':'g','ｇ':'g','𝐠':'g','𝑔':'g','𝒈':'g','𝓰':'g','𝔤':'g','𝕘':'g','𝖌':'g','𝗀':'g','𝗴':'g','𝘨':'g','𝙜':'g','𝚐':'g','һ':'h','հ':'h','Ꮒ':'h','ℎ':'h','ｈ':'h','𝐡':'h','𝒉':'h','𝒽':'h','𝓱':'h','𝔥':'h','𝕙':'h','𝖍':'h','𝗁':'h','𝗵':'h','𝘩':'h','𝙝':'h','𝚑':'h','ϳ':'j','ј':'j','ⅉ':'j','ｊ':'j','𝐣':'j','𝑗':'j','𝒋':'j','𝒿':'j','𝓳':'j','𝔧':'j','𝕛':'j','𝖏':'j','𝗃':'j','𝗷':'j','𝘫':'j','𝙟':'j','𝚓':'j','ｋ':'k','𝐤':'k','𝑘':'k','𝒌':'k','𝓀':'k','𝓴':'k','𝔨':'k','𝕜':'k','𝖐':'k','𝗄':'k','𝗸':'k','𝘬':'k','𝙠':'k','𝚔':'k','ｍ':'m','ո':'n','ռ':'n','ｎ':'n','𝐧':'n','𝑛':'n','𝒏':'n','𝓃':'n','𝓷':'n','𝔫':'n','𝕟':'n','𝖓':'n','𝗇':'n','𝗻':'n','𝘯':'n','𝙣':'n','𝚗':'n','ϱ':'p','⍴':'p','ⲣ':'p','ｐ':'p','𝐩':'p','𝑝':'p','𝒑':'p','𝓅':'p','𝓹':'p','𝔭':'p','𝕡':'p','𝖕':'p','𝗉':'p','𝗽':'p','𝘱':'p','𝙥':'p','𝚙':'p','𝛒':'p','𝛠':'p','𝜌':'p','𝜚':'p','𝝆':'p','𝝔':'p','𝞀':'p','𝞎':'p','𝞺':'p','𝟈':'p','ԛ':'q','գ':'q','զ':'q','ｑ':'q','𝐪':'q','𝑞':'q','𝒒':'q','𝓆':'q','𝓺':'q','𝔮':'q','𝕢':'q','𝖖':'q','𝗊':'q','𝗾':'q','𝘲':'q','𝙦':'q','𝚚':'q','г':'r','ᴦ':'r','ⲅ':'r','ꭇ':'r','ꭈ':'r','ꮁ':'r','ｒ':'r','𝐫':'r','𝑟':'r','𝒓':'r','𝓇':'r','𝓻':'r','𝔯':'r','𝕣':'r','𝖗':'r','𝗋':'r','𝗿':'r','𝘳':'r','𝙧':'r','𝚛':'r','ƽ':'s','ꜱ':'s','ꮪ':'s','ｓ':'s','𐑈':'s','𑣁':'s','𝐬':'s','𝑠':'s','𝒔':'s','𝓈':'s','𝓼':'s','𝔰':'s','𝕤':'s','𝖘':'s','𝗌':'s','𝘀':'s','𝘴':'s','𝙨':'s','𝚜':'s','ｔ':'t','𝐭':'t','𝑡':'t','𝒕':'t','𝓉':'t','𝓽':'t','𝔱':'t','𝕥':'t','𝖙':'t','𝗍':'t','𝘁':'t','𝘵':'t','𝙩':'t','𝚝':'t','ʋ':'u','ս':'u','ᴜ':'u','ꞟ':'u','ꭎ':'u','ꭒ':'u','ｕ':'u','𐓶':'u','𑣘':'u','𝐮':'u','𝑢':'u','𝒖':'u','𝓊':'u','𝓾':'u','𝔲':'u','𝕦':'u','𝖚':'u','𝗎':'u','𝘂':'u','𝘶':'u','𝙪':'u','𝚞':'u','𝛖':'u','𝜐':'u','𝝊':'u','𝞄':'u','𝞾':'u','ѵ':'v','ט':'v','ᴠ':'v','ⅴ':'v','∨':'v','⋁':'v','ꮩ':'v','ｖ':'v','𑜆':'v','𑣀':'v','𝐯':'v','𝑣':'v','𝒗':'v','𝓋':'v','𝓿':'v','𝔳':'v','𝕧':'v','𝖛':'v','𝗏':'v','𝘃':'v','𝘷':'v','𝙫':'v','𝚟':'v','𝛎':'v','𝜈':'v','𝝂':'v','𝝼':'v','𝞶':'v','ɯ':'w','ѡ':'w','ԝ':'w','ա':'w','ᴡ':'w','ꮃ':'w','ｗ':'w','𑜊':'w','𑜎':'w','𑜏':'w','𝐰':'w','𝑤':'w','𝒘':'w','𝓌':'w','𝔀':'w','𝔴':'w','𝕨':'w','𝖜':'w','𝗐':'w','𝘄':'w','𝘸':'w','𝙬':'w','𝚠':'w','ᕁ':'x','ᕽ':'x','᙮':'x','ⅹ':'x','⤫':'x','⤬':'x','⨯':'x','ｘ':'x','𝐱':'x','𝑥':'x','𝒙':'x','𝓍':'x','𝔁':'x','𝔵':'x','𝕩':'x','𝖝':'x','𝗑':'x','𝘅':'x','𝘹':'x','𝙭':'x','𝚡':'x','ɣ':'y','ʏ':'y','ү':'y','ყ':'y','ᶌ':'y','ỿ':'y','ℽ':'y','ꭚ':'y','ｙ':'y','𑣜':'y','𝐲':'y','𝑦':'y','𝒚':'y','𝓎':'y','𝔂':'y','𝔶':'y','𝕪':'y','𝖞':'y','𝗒':'y','𝘆':'y','𝘺':'y','𝙮':'y','𝚢':'y','𝛄':'y','𝛾':'y','𝜸':'y','𝝲':'y','𝞬':'y','ᴢ':'z','ꮓ':'z','ｚ':'z','𑣄':'z','𝐳':'z','𝑧':'z','𝒛':'z','𝓏':'z','𝔃':'z','𝔷':'z','𝕫':'z','𝖟':'z','𝗓':'z','𝘇':'z','𝘻':'z','𝙯':'z','𝚣':'z','Α':'a','А':'a','Ꭺ':'a','ᗅ':'a','ᴀ':'a','ꓮ':'a','ꭺ':'a','Ａ':'a','𐊠':'a','𖽀':'a','𝐀':'a','𝐴':'a','𝑨':'a','𝒜':'a','𝓐':'a','𝔄':'a','𝔸':'a','𝕬':'a','𝖠':'a','𝗔':'a','𝘈':'a','𝘼':'a','𝙰':'a','𝚨':'a','𝛢':'a','𝜜':'a','𝝖':'a','𝞐':'a','ʙ':'b','Β':'b','В':'b','Ᏼ':'b','ᏼ':'b','ᗷ':'b','ᛒ':'b','ℬ':'b','ꓐ':'b','Ꞵ':'b','Ｂ':'b','𐊂':'b','𐊡':'b','𐌁':'b','𝐁':'b','𝐵':'b','𝑩':'b','𝓑':'b','𝔅':'b','𝔹':'b','𝕭':'b','𝖡':'b','𝗕':'b','𝘉':'b','𝘽':'b','𝙱':'b','𝚩':'b','𝛣':'b','𝜝':'b','𝝗':'b','𝞑':'b','Ϲ':'c','С':'c','Ꮯ':'c','ᑕ':'c','ℂ':'c','ℭ':'c','Ⅽ':'c','⊂':'c','Ⲥ':'c','⸦':'c','ꓚ':'c','Ｃ':'c','𐊢':'c','𐌂':'c','𐐕':'c','𐔜':'c','𑣩':'c','𑣲':'c','𝐂':'c','𝐶':'c','𝑪':'c','𝒞':'c','𝓒':'c','𝕮':'c','𝖢':'c','𝗖':'c','𝘊':'c','𝘾':'c','𝙲':'c','🝌':'c','Ꭰ':'d','ᗞ':'d','ᗪ':'d','ᴅ':'d','ⅅ':'d','Ⅾ':'d','ꓓ':'d','ꭰ':'d','Ｄ':'d','𝐃':'d','𝐷':'d','𝑫':'d','𝒟':'d','𝓓':'d','𝔇':'d','𝔻':'d','𝕯':'d','𝖣':'d','𝗗':'d','𝘋':'d','𝘿':'d','𝙳':'d','Ε':'e','Е':'e','Ꭼ':'e','ᴇ':'e','ℰ':'e','⋿':'e','ⴹ':'e','ꓰ':'e','ꭼ':'e','Ｅ':'e','𐊆':'e','𑢦':'e','𑢮':'e','𝐄':'e','𝐸':'e','𝑬':'e','𝓔':'e','𝔈':'e','𝔼':'e','𝕰':'e','𝖤':'e','𝗘':'e','𝘌':'e','𝙀':'e','𝙴':'e','𝚬':'e','𝛦':'e','𝜠':'e','𝝚':'e','𝞔':'e','Ϝ':'f','ᖴ':'f','ℱ':'f','ꓝ':'f','Ꞙ':'f','Ｆ':'f','𐊇':'f','𐊥':'f','𐔥':'f','𑢢':'f','𑣂':'f','𝈓':'f','𝐅':'f','𝐹':'f','𝑭':'f','𝓕':'f','𝔉':'f','𝔽':'f','𝕱':'f','𝖥':'f','𝗙':'f','𝘍':'f','𝙁':'f','𝙵':'f','𝟊':'f','ɢ':'g','Ԍ':'g','ԍ':'g','Ꮐ':'g','Ᏻ':'g','ᏻ':'g','ꓖ':'g','ꮐ':'g','Ｇ':'g','𝐆':'g','𝐺':'g','𝑮':'g','𝒢':'g','𝓖':'g','𝔊':'g','𝔾':'g','𝕲':'g','𝖦':'g','𝗚':'g','𝘎':'g','𝙂':'g','𝙶':'g','ʜ':'h','Η':'h','Н':'h','Ꮋ':'h','ᕼ':'h','ℋ':'h','ℌ':'h','ℍ':'h','Ⲏ':'h','ꓧ':'h','ꮋ':'h','Ｈ':'h','𐋏':'h','𝐇':'h','𝐻':'h','𝑯':'h','𝓗':'h','𝕳':'h','𝖧':'h','𝗛':'h','𝘏':'h','𝙃':'h','𝙷':'h','𝚮':'h','𝛨':'h','𝜢':'h','𝝜':'h','𝞖':'h','Ϳ':'j','Ј':'j','Ꭻ':'j','ᒍ':'j','ᴊ':'j','ꓙ':'j','Ʝ':'j','ꭻ':'j','Ｊ':'j','𝐉':'j','𝐽':'j','𝑱':'j','𝒥':'j','𝓙':'j','𝔍':'j','𝕁':'j','𝕵':'j','𝖩':'j','𝗝':'j','𝘑':'j','𝙅':'j','𝙹':'j','Κ':'k','К':'k','Ꮶ':'k','ᛕ':'k','K':'k','Ⲕ':'k','ꓗ':'k','Ｋ':'k','𐔘':'k','𝐊':'k','𝐾':'k','𝑲':'k','𝒦':'k','𝓚':'k','𝔎':'k','𝕂':'k','𝕶':'k','𝖪':'k','𝗞':'k','𝘒':'k','𝙆':'k','𝙺':'k','𝚱':'k','𝛫':'k','𝜥':'k','𝝟':'k','𝞙':'k','ʟ':'l','Ꮮ':'l','ᒪ':'l','ℒ':'l','Ⅼ':'l','Ⳑ':'l','ⳑ':'l','ꓡ':'l','ꮮ':'l','Ｌ':'l','𐐛':'l','𐑃':'l','𐔦':'l','𑢣':'l','𑢲':'l','𖼖':'l','𝈪':'l','𝐋':'l','𝐿':'l','𝑳':'l','𝓛':'l','𝔏':'l','𝕃':'l','𝕷':'l','𝖫':'l','𝗟':'l','𝘓':'l','𝙇':'l','𝙻':'l','Μ':'m','Ϻ':'m','М':'m','Ꮇ':'m','ᗰ':'m','ᛖ':'m','ℳ':'m','Ⅿ':'m','Ⲙ':'m','ꓟ':'m','Ｍ':'m','𐊰':'m','𐌑':'m','𝐌':'m','𝑀':'m','𝑴':'m','𝓜':'m','𝔐':'m','𝕄':'m','𝕸':'m','𝖬':'m','𝗠':'m','𝘔':'m','𝙈':'m','𝙼':'m','𝚳':'m','𝛭':'m','𝜧':'m','𝝡':'m','𝞛':'m','ɴ':'n','Ν':'n','ℕ':'n','Ⲛ':'n','ꓠ':'n','Ｎ':'n','𐔓':'n','𝐍':'n','𝑁':'n','𝑵':'n','𝒩':'n','𝓝':'n','𝔑':'n','𝕹':'n','𝖭':'n','𝗡':'n','𝘕':'n','𝙉':'n','𝙽':'n','𝚴':'n','𝛮':'n','𝜨':'n','𝝢':'n','𝞜':'n','Ρ':'p','Р':'p','Ꮲ':'p','ᑭ':'p','ᴘ':'p','ᴩ':'p','ℙ':'p','Ⲣ':'p','ꓑ':'p','ꮲ':'p','Ｐ':'p','𐊕':'p','𝐏':'p','𝑃':'p','𝑷':'p','𝒫':'p','𝓟':'p','𝔓':'p','𝕻':'p','𝖯':'p','𝗣':'p','𝘗':'p','𝙋':'p','𝙿':'p','𝚸':'p','𝛲':'p','𝜬':'p','𝝦':'p','𝞠':'p','ℚ':'q','ⵕ':'q','Ｑ':'q','𝐐':'q','𝑄':'q','𝑸':'q','𝒬':'q','𝓠':'q','𝔔':'q','𝕼':'q','𝖰':'q','𝗤':'q','𝘘':'q','𝙌':'q','𝚀':'q','Ʀ':'r','ʀ':'r','Ꭱ':'r','Ꮢ':'r','ᖇ':'r','ᚱ':'r','ℛ':'r','ℜ':'r','ℝ':'r','ꓣ':'r','ꭱ':'r','ꮢ':'r','Ｒ':'r','𐒴':'r','𖼵':'r','𝈖':'r','𝐑':'r','𝑅':'r','𝑹':'r','𝓡':'r','𝕽':'r','𝖱':'r','𝗥':'r','𝘙':'r','𝙍':'r','𝚁':'r','Ѕ':'s','Տ':'s','Ꮥ':'s','Ꮪ':'s','ꓢ':'s','Ｓ':'s','𐊖':'s','𐐠':'s','𖼺':'s','𝐒':'s','𝑆':'s','𝑺':'s','𝒮':'s','𝓢':'s','𝔖':'s','𝕊':'s','𝕾':'s','𝖲':'s','𝗦':'s','𝘚':'s','𝙎':'s','𝚂':'s','Τ':'t','Т':'t','Ꭲ':'t','ᴛ':'t','⊤':'t','⟙':'t','Ⲧ':'t','ꓔ':'t','ꭲ':'t','Ｔ':'t','𐊗':'t','𐊱':'t','𐌕':'t','𑢼':'t','𖼊':'t','𝐓':'t','𝑇':'t','𝑻':'t','𝒯':'t','𝓣':'t','𝔗':'t','𝕋':'t','𝕿':'t','𝖳':'t','𝗧':'t','𝘛':'t','𝙏':'t','𝚃':'t','𝚻':'t','𝛕':'t','𝛵':'t','𝜏':'t','𝜯':'t','𝝉':'t','𝝩':'t','𝞃':'t','𝞣':'t','𝞽':'t','🝨':'t','Ս':'u','ሀ':'u','ᑌ':'u','∪':'u','⋃':'u','ꓴ':'u','Ｕ':'u','𐓎':'u','𑢸':'u','𖽂':'u','𝐔':'u','𝑈':'u','𝑼':'u','𝒰':'u','𝓤':'u','𝔘':'u','𝕌':'u','𝖀':'u','𝖴':'u','𝗨':'u','𝘜':'u','𝙐':'u','𝚄':'u','Ѵ':'v','٧':'v','۷':'v','Ꮩ':'v','ᐯ':'v','Ⅴ':'v','ⴸ':'v','ꓦ':'v','ꛟ':'v','Ｖ':'v','𐔝':'v','𑢠':'v','𖼈':'v','𝈍':'v','𝐕':'v','𝑉':'v','𝑽':'v','𝒱':'v','𝓥':'v','𝔙':'v','𝕍':'v','𝖁':'v','𝖵':'v','𝗩':'v','𝘝':'v','𝙑':'v','𝚅':'v','Ԝ':'w','Ꮃ':'w','Ꮤ':'w','ꓪ':'w','Ｗ':'w','𑣦':'w','𑣯':'w','𝐖':'w','𝑊':'w','𝑾':'w','𝒲':'w','𝓦':'w','𝔚':'w','𝕎':'w','𝖂':'w','𝖶':'w','𝗪':'w','𝘞':'w','𝙒':'w','𝚆':'w','Χ':'x','Х':'x','᙭':'x','ᚷ':'x','Ⅹ':'x','╳':'x','Ⲭ':'x','ⵝ':'x','ꓫ':'x','Ꭓ':'x','Ｘ':'x','𐊐':'x','𐊴':'x','𐌗':'x','𐌢':'x','𐔧':'x','𑣬':'x','𝐗':'x','𝑋':'x','𝑿':'x','𝒳':'x','𝓧':'x','𝔛':'x','𝕏':'x','𝖃':'x','𝖷':'x','𝗫':'x','𝘟':'x','𝙓':'x','𝚇':'x','𝚾':'x','𝛸':'x','𝜲':'x','𝝬':'x','𝞦':'x','Υ':'y','ϒ':'y','У':'y','Ү':'y','Ꭹ':'y','Ꮍ':'y','Ⲩ':'y','ꓬ':'y','Ｙ':'y','𐊲':'y','𑢤':'y','𖽃':'y','𝐘':'y','𝑌':'y','𝒀':'y','𝒴':'y','𝓨':'y','𝔜':'y','𝕐':'y','𝖄':'y','𝖸':'y','𝗬':'y','𝘠':'y','𝙔':'y','𝚈':'y','𝚼':'y','𝛶':'y','𝜰':'y','𝝪':'y','𝞤':'y','Ζ':'z','Ꮓ':'z','ℤ':'z','ℨ':'z','ꓜ':'z','Ｚ':'z','𐋵':'z','𑢩':'z','𑣥':'z','𝐙':'z','𝑍':'z','𝒁':'z','𝒵':'z','𝓩':'z','𝖅':'z','𝖹':'z','𝗭':'z','𝘡':'z','𝙕':'z','𝚉':'z','𝚭':'z','𝛧':'z','𝜡':'z','𝝛':'z','𝞕':'z'};

            console.log('WordFilter initialized successfully');
        } catch (error) {
            console.error('Error initializing WordFilter:', error);
            throw error;
        }
    }

    /**
     * Converts a given string to its alphanumeric representation, mapping obfuscated characters
     * to their standard counterparts.
     * @param {string} text - The input text to normalize.
     * @returns {string} The normalized alphanumeric string.
     */
    stringToAlphanumeric(text) {
        let result = '';
        for (let char of text) {
            let lowerChar = char.toLowerCase();
            lowerChar = lowerChar.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
            let mappedChar = this.obfuscationMap[lowerChar] || lowerChar;
            if (/[a-z0-9]/.test(mappedChar)) {
                result += mappedChar;
            } else {
                // Ignore non-alphanumeric characters
            }
        }
        return result;
    }

    checkText(text) {
        const cacheKey = text;
        if (this.cache.has(cacheKey)) {
            this.cacheHits++;
            return this.cache.get(cacheKey);
        }

        this.cacheMisses++;
        let result = { hasOffensiveWord: false, offensiveRanges: [] };

        const lines = text.split(/\r?\n/);
        let overallIndex = 0;

        for (const line of lines) {
            const normalizedLine = this.stringToAlphanumeric(line);
            let i = 0;
            while (i < normalizedLine.length) {
                let maxOffensiveMatchLength = 0;
                let maxWhitelistMatchLength = 0;

                // Check for offensive word starting at position i
                let node = this.offensiveTrie.root;
                let j = i;
                while (j < normalizedLine.length && node.children[normalizedLine[j]]) {
                    node = node.children[normalizedLine[j]];
                    j++;
                    if (node.isEndOfWord) {
                        maxOffensiveMatchLength = j - i;
                    }
                }

                // Check for whitelisted word starting at position i
                node = this.whitelistTrie.root;
                j = i;
                while (j < normalizedLine.length && node.children[normalizedLine[j]]) {
                    node = node.children[normalizedLine[j]];
                    j++;
                    if (node.isEndOfWord) {
                        maxWhitelistMatchLength = j - i;
                    }
                }

                if (maxOffensiveMatchLength > 0 && maxOffensiveMatchLength >= maxWhitelistMatchLength) {
                    // Offensive word found and not whitelisted
                    result.hasOffensiveWord = true;
                    const startIndex = this.findOriginalIndex(line, i) + overallIndex;
                    const endIndex = this.findOriginalIndex(line, i + maxOffensiveMatchLength) + overallIndex;
                    result.offensiveRanges.push([startIndex, endIndex]);
                    i += maxOffensiveMatchLength;
                } else {
                    i++;
                }
            }
            overallIndex += line.length + 1; // +1 for the newline character
        }

        this.cache.set(cacheKey, result);
        if (this.cache.size > this.cacheSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        return result;
    }

    findOriginalIndex(originalText, normalizedIndex) {
        let normalizedText = '';
        let indexMapping = [];
        let currentIndex = 0;

        // Build normalized text and keep track of the original indices
        for (let i = 0; i < originalText.length; i++) {
            let char = originalText[i];
            let lowerChar = char.toLowerCase();
            lowerChar = lowerChar.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            let mappedChar = this.obfuscationMap[lowerChar] || lowerChar;

            if (/[a-z0-9]/.test(mappedChar)) {
                normalizedText += mappedChar;
                indexMapping.push(i); // Map from normalized index to original index
                currentIndex++;
            } else {
                // Non-alphanumeric character, skip but keep going
            }
        }

        // Handle out-of-bounds indices
        if (normalizedIndex >= indexMapping.length) {
            return originalText.length;
        }

        return indexMapping[normalizedIndex];
    }

    filterText(text) {
        const { offensiveRanges } = this.checkText(text);
        if (offensiveRanges.length === 0) return text;

        let filteredText = '';
        let lastIndex = 0;

        for (const [start, end] of offensiveRanges) {
            filteredText += text.slice(lastIndex, start);
            filteredText += '*'.repeat(end - start);
            lastIndex = end;
        }

        filteredText += text.slice(lastIndex);
        return filteredText;
    }

    getCacheStats() {
        return {
            size: this.cache.size,
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0
        };
    }

    clearCache() {
        this.cache.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }
}

module.exports = WordFilter;
