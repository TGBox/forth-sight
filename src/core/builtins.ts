import { parseStackEffect, type StackEffect } from './stackComment';

/** A word provided by the Forth system itself (Forth-2012 plus common gforth extensions). */
export interface BuiltinWord {
  name: string;
  /** Stack effect without the surrounding parentheses, e.g. "x -- x x". */
  stack: string;
  description: string;
  category: string;
  /** Data stack effect, or null if it is variable or cannot be expressed as fixed counts. */
  effect: StackEffect | null;
}

// Format per line:  name :: stack effect :: description
// Further stacks are written the way they appear in a hover: "x -- ) ( R: -- x".
const TABLE: Record<string, string> = {
  Stack: `
dup :: x -- x x :: Dupliziert den obersten Stackwert.
drop :: x -- :: Entfernt den obersten Stackwert.
swap :: x1 x2 -- x2 x1 :: Vertauscht die beiden obersten Stackwerte.
over :: x1 x2 -- x1 x2 x1 :: Kopiert den zweiten Stackwert nach oben.
rot :: x1 x2 x3 -- x2 x3 x1 :: Rotiert den dritten Stackwert nach oben.
-rot :: x1 x2 x3 -- x3 x1 x2 :: Rotiert den obersten Stackwert an die dritte Position.
nip :: x1 x2 -- x2 :: Entfernt den zweiten Stackwert.
tuck :: x1 x2 -- x2 x1 x2 :: Kopiert den obersten Stackwert unter den zweiten.
?dup :: x -- 0 | x x :: Dupliziert den obersten Stackwert nur, wenn er ungleich 0 ist.
pick :: xu ... x0 u -- xu ... x0 xu :: Kopiert den u-ten Stackwert nach oben (0 pick = dup).
roll :: xu ... x0 u -- xu-1 ... x0 xu :: Holt den u-ten Stackwert nach oben (2 roll = rot).
2dup :: x1 x2 -- x1 x2 x1 x2 :: Dupliziert das oberste Zellenpaar.
2drop :: x1 x2 -- :: Entfernt das oberste Zellenpaar.
2swap :: x1 x2 x3 x4 -- x3 x4 x1 x2 :: Vertauscht die beiden obersten Zellenpaare.
2over :: x1 x2 x3 x4 -- x1 x2 x3 x4 x1 x2 :: Kopiert das zweite Zellenpaar nach oben.
2rot :: x1 x2 x3 x4 x5 x6 -- x3 x4 x5 x6 x1 x2 :: Rotiert das dritte Zellenpaar nach oben.
2nip :: x1 x2 x3 x4 -- x3 x4 :: Entfernt das zweite Zellenpaar (gforth).
2tuck :: x1 x2 x3 x4 -- x3 x4 x1 x2 x3 x4 :: Kopiert das oberste Zellenpaar unter das zweite (gforth).
third :: x1 x2 x3 -- x1 x2 x3 x1 :: Kopiert den dritten Stackwert nach oben (gforth).
depth :: -- +n :: Anzahl der Werte auf dem Datenstack.
`,
  Returnstack: `
>r :: x -- ) ( R: -- x :: Verschiebt den obersten Wert auf den Returnstack.
r> :: -- x ) ( R: x -- :: Holt den obersten Wert vom Returnstack zurück.
r@ :: -- x ) ( R: x -- x :: Kopiert den obersten Wert des Returnstacks.
2>r :: x1 x2 -- ) ( R: -- x1 x2 :: Verschiebt ein Zellenpaar auf den Returnstack.
2r> :: -- x1 x2 ) ( R: x1 x2 -- :: Holt ein Zellenpaar vom Returnstack zurück.
2r@ :: -- x1 x2 ) ( R: x1 x2 -- x1 x2 :: Kopiert das oberste Zellenpaar des Returnstacks.
rdrop :: -- ) ( R: x -- :: Entfernt den obersten Wert des Returnstacks (gforth).
2rdrop :: -- ) ( R: x1 x2 -- :: Entfernt das oberste Zellenpaar des Returnstacks (gforth).
n>r :: i*x n -- ) ( R: -- i*x n :: Verschiebt n Werte samt Anzahl auf den Returnstack.
nr> :: -- i*x n ) ( R: i*x n -- :: Holt mit n>r gesicherte Werte zurück.
`,
  Arithmetik: `
+ :: n1 n2 -- n3 :: Addition.
- :: n1 n2 -- n3 :: Subtraktion (n1 minus n2).
* :: n1 n2 -- n3 :: Multiplikation.
/ :: n1 n2 -- n3 :: Ganzzahlige Division (n1 durch n2).
mod :: n1 n2 -- n3 :: Divisionsrest von n1 durch n2.
/mod :: n1 n2 -- n3 n4 :: Liefert Rest n3 und Quotient n4.
*/ :: n1 n2 n3 -- n4 :: n1*n2/n3 mit doppelt genauem Zwischenergebnis.
*/mod :: n1 n2 n3 -- n4 n5 :: n1*n2/n3, liefert Rest n4 und Quotient n5.
1+ :: n1 -- n2 :: Erhöht um 1.
1- :: n1 -- n2 :: Vermindert um 1.
2* :: x1 -- x2 :: Verdoppelt (Linksschieben um 1 Bit).
2/ :: x1 -- x2 :: Halbiert (arithmetisches Rechtsschieben um 1 Bit).
abs :: n -- u :: Absolutbetrag.
negate :: n1 -- n2 :: Vorzeichenwechsel.
min :: n1 n2 -- n3 :: Kleinerer der beiden Werte.
max :: n1 n2 -- n3 :: Größerer der beiden Werte.
within :: n1 n2 n3 -- flag :: Wahr, wenn n2 <= n1 < n3.
under+ :: n1 n2 n3 -- n4 n2 :: Addiert n3 auf den dritten Stackwert (gforth).
bounds :: addr u -- addr+u addr :: Wandelt Adresse/Länge in Grenzen für eine do-Schleife um (gforth).
um* :: u1 u2 -- ud :: Vorzeichenlose Multiplikation mit doppelt genauem Ergebnis.
um/mod :: ud u1 -- u2 u3 :: Vorzeichenlose Division, liefert Rest u2 und Quotient u3.
m* :: n1 n2 -- d :: Multiplikation mit doppelt genauem Ergebnis.
fm/mod :: d n1 -- n2 n3 :: Floored Division, liefert Rest n2 und Quotient n3.
sm/rem :: d n1 -- n2 n3 :: Symmetrische Division, liefert Rest n2 und Quotient n3.
s>d :: n -- d :: Erweitert eine einfache Zahl auf doppelte Genauigkeit.
d>s :: d -- n :: Verkürzt eine doppelt genaue Zahl auf eine Zelle.
m+ :: d1 n -- d2 :: Addiert eine einfache zu einer doppelt genauen Zahl.
m*/ :: d1 n1 +n2 -- d2 :: d1*n1/n2 mit dreifach genauem Zwischenergebnis.
d+ :: d1 d2 -- d3 :: Addition doppelt genauer Zahlen.
d- :: d1 d2 -- d3 :: Subtraktion doppelt genauer Zahlen.
dnegate :: d1 -- d2 :: Vorzeichenwechsel einer doppelt genauen Zahl.
dabs :: d -- ud :: Absolutbetrag einer doppelt genauen Zahl.
d2* :: xd1 -- xd2 :: Verdoppelt eine doppelt genaue Zahl.
d2/ :: xd1 -- xd2 :: Halbiert eine doppelt genaue Zahl.
dmin :: d1 d2 -- d3 :: Kleinere der beiden doppelt genauen Zahlen.
dmax :: d1 d2 -- d3 :: Größere der beiden doppelt genauen Zahlen.
`,
  'Logik und Vergleich': `
and :: x1 x2 -- x3 :: Bitweises UND.
or :: x1 x2 -- x3 :: Bitweises ODER.
xor :: x1 x2 -- x3 :: Bitweises Exklusiv-ODER.
invert :: x1 -- x2 :: Bitweise Negation.
lshift :: x1 u -- x2 :: Schiebt um u Bits nach links.
rshift :: x1 u -- x2 :: Schiebt logisch um u Bits nach rechts.
arshift :: n1 u -- n2 :: Schiebt arithmetisch um u Bits nach rechts (gforth).
true :: -- true :: Wahr-Flag (alle Bits gesetzt, -1).
false :: -- false :: Falsch-Flag (0).
= :: x1 x2 -- flag :: Wahr, wenn beide Werte gleich sind.
<> :: x1 x2 -- flag :: Wahr, wenn die Werte verschieden sind.
< :: n1 n2 -- flag :: Wahr, wenn n1 kleiner als n2 ist.
> :: n1 n2 -- flag :: Wahr, wenn n1 größer als n2 ist.
<= :: n1 n2 -- flag :: Wahr, wenn n1 kleiner oder gleich n2 ist (gforth).
>= :: n1 n2 -- flag :: Wahr, wenn n1 größer oder gleich n2 ist (gforth).
u< :: u1 u2 -- flag :: Vorzeichenloser Vergleich: u1 kleiner als u2.
u> :: u1 u2 -- flag :: Vorzeichenloser Vergleich: u1 größer als u2.
u<= :: u1 u2 -- flag :: Vorzeichenloser Vergleich: kleiner oder gleich (gforth).
u>= :: u1 u2 -- flag :: Vorzeichenloser Vergleich: größer oder gleich (gforth).
0= :: x -- flag :: Wahr, wenn der Wert 0 ist (auch als logisches NICHT).
0<> :: x -- flag :: Wahr, wenn der Wert ungleich 0 ist.
0< :: n -- flag :: Wahr, wenn der Wert negativ ist.
0> :: n -- flag :: Wahr, wenn der Wert positiv ist.
0<= :: n -- flag :: Wahr, wenn der Wert kleiner oder gleich 0 ist (gforth).
0>= :: n -- flag :: Wahr, wenn der Wert größer oder gleich 0 ist (gforth).
d0= :: xd -- flag :: Wahr, wenn die doppelt genaue Zahl 0 ist.
d0< :: d -- flag :: Wahr, wenn die doppelt genaue Zahl negativ ist.
d= :: xd1 xd2 -- flag :: Vergleicht zwei doppelt genaue Zahlen auf Gleichheit.
d< :: d1 d2 -- flag :: Wahr, wenn d1 kleiner als d2 ist.
du< :: ud1 ud2 -- flag :: Vorzeichenloser Vergleich doppelt genauer Zahlen.
`,
  Speicher: `
@ :: a-addr -- x :: Liest eine Zelle von der Adresse.
! :: x a-addr -- :: Schreibt eine Zelle an die Adresse.
+! :: n a-addr -- :: Addiert n auf die Zelle an der Adresse.
c@ :: c-addr -- char :: Liest ein Zeichen (Byte) von der Adresse.
c! :: char c-addr -- :: Schreibt ein Zeichen (Byte) an die Adresse.
2@ :: a-addr -- x1 x2 :: Liest ein Zellenpaar von der Adresse.
2! :: x1 x2 a-addr -- :: Schreibt ein Zellenpaar an die Adresse.
w@ :: c-addr -- u :: Liest einen 16-Bit-Wert (gforth).
w! :: u c-addr -- :: Schreibt einen 16-Bit-Wert (gforth).
l@ :: c-addr -- u :: Liest einen 32-Bit-Wert (gforth).
l! :: u c-addr -- :: Schreibt einen 32-Bit-Wert (gforth).
on :: a-addr -- :: Setzt die Zelle an der Adresse auf true (gforth).
off :: a-addr -- :: Setzt die Zelle an der Adresse auf false (gforth).
here :: -- addr :: Adresse des nächsten freien Platzes im Datenbereich.
allot :: n -- :: Reserviert n Adresseinheiten im Datenbereich.
, :: x -- :: Legt eine Zelle im Datenbereich ab.
c, :: char -- :: Legt ein Zeichen im Datenbereich ab.
2, :: x1 x2 -- :: Legt ein Zellenpaar im Datenbereich ab (gforth).
align :: -- :: Richtet den Datenbereichszeiger auf eine Zellengrenze aus.
aligned :: addr -- a-addr :: Rundet die Adresse auf die nächste Zellengrenze auf.
cell :: -- u :: Größe einer Zelle in Adresseinheiten (gforth).
cells :: n1 -- n2 :: Größe von n1 Zellen in Adresseinheiten.
cell+ :: a-addr1 -- a-addr2 :: Erhöht die Adresse um eine Zellengröße.
cell- :: a-addr1 -- a-addr2 :: Vermindert die Adresse um eine Zellengröße (gforth).
chars :: n1 -- n2 :: Größe von n1 Zeichen in Adresseinheiten.
char+ :: c-addr1 -- c-addr2 :: Erhöht die Adresse um eine Zeichengröße.
fill :: c-addr u char -- :: Füllt u Zeichen ab der Adresse mit char.
erase :: addr u -- :: Setzt u Adresseinheiten ab der Adresse auf 0.
blank :: c-addr u -- :: Füllt u Zeichen ab der Adresse mit Leerzeichen.
move :: addr1 addr2 u -- :: Kopiert u Adresseinheiten von addr1 nach addr2 (überlappungssicher).
cmove :: c-addr1 c-addr2 u -- :: Kopiert u Zeichen aufsteigend von c-addr1 nach c-addr2.
cmove> :: c-addr1 c-addr2 u -- :: Kopiert u Zeichen absteigend von c-addr1 nach c-addr2.
unused :: -- u :: Noch freier Platz im Datenbereich.
pad :: -- c-addr :: Adresse eines temporären Arbeitspuffers.
>body :: xt -- a-addr :: Datenfeldadresse eines mit create definierten Wortes.
allocate :: u -- a-addr ior :: Fordert u Adresseinheiten dynamischen Speicher an.
free :: a-addr -- ior :: Gibt mit allocate angeforderten Speicher frei.
resize :: a-addr1 u -- a-addr2 ior :: Ändert die Größe eines Speicherblocks.
`,
  Kontrollstruktur: `
if :: flag -- :: Beginn einer Verzweigung: führt den folgenden Teil aus, wenn flag wahr ist.
else :: -- :: Beginn des Alternativzweigs einer if-Verzweigung.
then :: -- :: Ende einer if-Verzweigung.
endif :: -- :: Ende einer if-Verzweigung (gforth, wie then).
ahead :: -- :: Unbedingter Vorwärtssprung bis then.
begin :: -- :: Beginn einer Schleife (begin ... until / again / while ... repeat).
until :: flag -- :: Springt zu begin zurück, solange flag falsch ist.
again :: -- :: Springt unbedingt zu begin zurück (Endlosschleife).
while :: flag -- :: Verlässt die begin-Schleife hinter repeat, wenn flag falsch ist.
repeat :: -- :: Springt zu begin zurück; Ende einer begin ... while-Schleife.
do :: n1 n2 -- :: Beginn einer Zählschleife von n2 bis n1-1.
?do :: n1 n2 -- :: Wie do, überspringt die Schleife aber, wenn n1 = n2.
+do :: n1 n2 -- :: Zählschleife, die bei n2 >= n1 übersprungen wird (gforth).
u+do :: u1 u2 -- :: Vorzeichenlose Variante von +do (gforth).
-do :: n1 n2 -- :: Abwärts zählende Schleife, mit -loop zu schließen (gforth).
u-do :: u1 u2 -- :: Vorzeichenlose Variante von -do (gforth).
loop :: -- :: Erhöht den Schleifenindex um 1 und wiederholt bis zur Grenze.
+loop :: n -- :: Erhöht den Schleifenindex um n und wiederholt bis zur Grenze.
-loop :: u -- :: Vermindert den Schleifenindex um u (gforth).
i :: -- n :: Index der innersten do-Schleife.
j :: -- n :: Index der nächstäußeren do-Schleife.
k :: -- n :: Index der drittinnersten do-Schleife (gforth).
leave :: -- :: Verlässt die innerste do-Schleife sofort.
?leave :: flag -- :: Verlässt die innerste do-Schleife, wenn flag wahr ist (gforth).
unloop :: -- :: Verwirft die Schleifenparameter; nötig vor exit innerhalb einer do-Schleife.
case :: -- :: Beginn einer Fallunterscheidung (case ... of ... endof ... endcase).
of :: x1 x2 -- | x1 :: Führt den Zweig bis endof aus, wenn x1 = x2; sonst bleibt x1 liegen.
?of :: x flag -- | x :: Führt den Zweig bis endof aus, wenn flag wahr ist (gforth).
endof :: -- :: Ende eines of-Zweigs; springt hinter endcase.
endcase :: x -- :: Ende der Fallunterscheidung; verwirft den Auswahlwert.
exit :: -- :: Verlässt die aktuelle Definition sofort.
recurse :: -- :: Ruft die aktuelle Definition rekursiv auf.
execute :: i*x xt -- j*x :: Führt das Wort mit dem Execution Token xt aus.
perform :: i*x a-addr -- j*x :: Führt das an der Adresse gespeicherte xt aus (gforth, wie @ execute).
noop :: -- :: Tut nichts (gforth).
`,
  Definition: `
: :: "name" -- :: Beginnt eine Colon-Definition des Wortes name.
; :: -- :: Beendet eine Colon-Definition.
:noname :: -- xt :: Beginnt eine namenlose Definition; liefert nach ; deren xt.
variable :: "name" -- :: Definiert eine Variable (name liefert ihre Adresse).
2variable :: "name" -- :: Definiert eine Variable für ein Zellenpaar.
constant :: x "name" -- :: Definiert eine Konstante mit dem Wert x.
2constant :: x1 x2 "name" -- :: Definiert eine Konstante für ein Zellenpaar.
value :: x "name" -- :: Definiert einen Wert, der mit to geändert werden kann.
2value :: x1 x2 "name" -- :: Definiert einen Zellenpaar-Wert, änderbar mit to.
to :: x "name" -- :: Weist dem value oder der lokalen Variable name einen neuen Wert zu.
+to :: n "name" -- :: Addiert n auf den value name (gforth).
create :: "name" -- :: Definiert name; liefert bei Ausführung die Adresse des folgenden Datenbereichs.
does> :: -- :: Legt das Laufzeitverhalten der mit create definierten Wörter fest.
buffer: :: u "name" -- :: Definiert einen Puffer mit u Adresseinheiten.
defer :: "name" -- :: Definiert ein Wort, dessen Verhalten später mit is gesetzt wird.
is :: xt "name" -- :: Weist dem deferred Wort name das Verhalten xt zu.
action-of :: "name" -- xt :: Liefert das aktuelle Verhalten des deferred Wortes name.
defer@ :: xt1 -- xt2 :: Liest das Verhalten des deferred Wortes xt1.
defer! :: xt2 xt1 -- :: Setzt das Verhalten des deferred Wortes xt1 auf xt2.
marker :: "name" -- :: Definiert name; dessen Ausführung entfernt alle späteren Definitionen.
synonym :: "newname" "oldname" -- :: Definiert newname als Synonym für oldname.
alias :: xt "name" -- :: Definiert name als Alias für xt (gforth).
user :: "name" -- :: Definiert eine User-Variable (pro Task) (gforth).
immediate :: -- :: Markiert die zuletzt definierte Definition als immediate.
compile-only :: -- :: Markiert die letzte Definition als nur kompilierbar (gforth).
recursive :: -- :: Macht die aktuelle Definition unter ihrem Namen aufrufbar (gforth).
begin-structure :: "name" -- :: Beginnt eine Strukturdefinition; name liefert deren Größe.
end-structure :: -- :: Beendet eine Strukturdefinition.
field: :: n1 "name" -- n2 :: Definiert ein zellengroßes Strukturfeld.
cfield: :: n1 "name" -- n2 :: Definiert ein zeichengroßes Strukturfeld.
2field: :: n1 "name" -- n2 :: Definiert ein Strukturfeld für ein Zellenpaar (gforth).
+field :: n1 n2 "name" -- n3 :: Definiert ein Strukturfeld der Größe n2.
struct :: -- align size :: Beginnt eine Strukturdefinition alter Art (gforth).
end-struct :: align size "name" -- :: Beendet eine Strukturdefinition alter Art (gforth).
field :: align1 offset1 align size "name" -- align2 offset2 :: Definiert ein Strukturfeld alter Art (gforth).
cell% :: -- align size :: Ausrichtung und Größe einer Zelle (gforth-Strukturen).
char% :: -- align size :: Ausrichtung und Größe eines Zeichens (gforth-Strukturen).
code :: "name" -- :: Beginnt eine Assembler-Definition.
end-code :: -- :: Beendet eine Assembler-Definition.
;code :: -- :: Wie does>, das Laufzeitverhalten wird jedoch in Assembler angegeben.
{: :: -- :: Beginnt die Deklaration lokaler Variablen: {: arg ... | lokal ... -- kommentar :}.
:} :: -- :: Beendet die Deklaration lokaler Variablen.
locals| :: -- :: Deklariert lokale Variablen alter Art: locals| n2 n1 |.
`,
  'Compiler und Interpreter': `
' :: "name" -- xt :: Liefert das Execution Token des Wortes name.
['] :: "name" -- :: Kompiliert das Execution Token von name als Literal.
postpone :: "name" -- :: Kompiliert die Kompilationssemantik von name.
[compile] :: "name" -- :: Kompiliert ein immediate-Wort, statt es auszuführen (veraltet).
compile, :: xt -- :: Hängt die Ausführung von xt an die aktuelle Definition an.
literal :: x -- :: Kompiliert x als Literal in die aktuelle Definition.
2literal :: x1 x2 -- :: Kompiliert ein Zellenpaar als Literal.
sliteral :: c-addr u -- :: Kompiliert eine Zeichenkette als Literal.
[ :: -- :: Schaltet in den Interpretationsmodus.
] :: -- :: Schaltet in den Kompilationsmodus.
state :: -- a-addr :: Adresse des Zustandsflags (ungleich 0 beim Kompilieren).
char :: "name" -- char :: Liefert den Zeichencode des ersten Zeichens von name.
[char] :: "name" -- :: Kompiliert den Zeichencode des ersten Zeichens von name.
evaluate :: i*x c-addr u -- j*x :: Interpretiert die Zeichenkette als Forth-Quelltext.
find :: c-addr -- c-addr 0 | xt 1 | xt -1 :: Sucht das Wort der counted string im Wörterbuch.
find-name :: c-addr u -- nt | 0 :: Sucht ein Wort und liefert dessen Name Token (gforth).
name>string :: nt -- c-addr u :: Name zu einem Name Token.
name>interpret :: nt -- xt | 0 :: Interpretationssemantik zu einem Name Token.
name>compile :: nt -- x xt :: Kompilationssemantik zu einem Name Token.
latestxt :: -- xt :: Execution Token der zuletzt definierten Definition (gforth).
source :: -- c-addr u :: Aktueller Eingabepuffer.
>in :: -- a-addr :: Adresse des Offsets im Eingabepuffer.
source-id :: -- 0 | -1 | fileid :: Kennung der aktuellen Eingabequelle.
refill :: -- flag :: Liest die nächste Eingabezeile ein.
parse :: char "ccc<char>" -- c-addr u :: Liest die Eingabe bis zum Begrenzer char.
parse-name :: "name" -- c-addr u :: Liest das nächste durch Leerraum begrenzte Wort der Eingabe.
word :: char "ccc<char>" -- c-addr :: Liest ein durch char begrenztes Wort als counted string.
save-input :: -- xn ... x1 n :: Sichert die aktuelle Eingabeposition.
restore-input :: xn ... x1 n -- flag :: Stellt eine gesicherte Eingabeposition wieder her.
environment? :: c-addr u -- false | i*x true :: Fragt eine Systemeigenschaft ab.
[if] :: flag -- :: Bedingte Übersetzung: überspringt bis [else] oder [then], wenn flag falsch ist.
[else] :: -- :: Alternativzweig der bedingten Übersetzung.
[then] :: -- :: Ende der bedingten Übersetzung.
[endif] :: -- :: Ende der bedingten Übersetzung (gforth, wie [then]).
[defined] :: "name" -- flag :: Wahr, wenn name definiert ist.
[undefined] :: "name" -- flag :: Wahr, wenn name nicht definiert ist.
[ifdef] :: "name" -- :: Bedingte Übersetzung, wenn name definiert ist (gforth).
[ifundef] :: "name" -- :: Bedingte Übersetzung, wenn name nicht definiert ist (gforth).
include :: i*x "file" -- j*x :: Lädt und interpretiert die Datei file.
included :: i*x c-addr u -- j*x :: Lädt und interpretiert die Datei mit dem angegebenen Namen.
include-file :: i*x fileid -- j*x :: Interpretiert die geöffnete Datei.
require :: i*x "file" -- i*x :: Lädt die Datei file, falls sie noch nicht geladen wurde.
required :: i*x c-addr u -- i*x :: Lädt die Datei, falls sie noch nicht geladen wurde.
needs :: i*x "file" -- i*x :: Wie require (gforth).
bye :: -- :: Beendet das Forth-System.
quit :: -- ) ( R: i*x -- :: Leert den Returnstack und kehrt zur Eingabeaufforderung zurück.
abort :: i*x -- ) ( R: j*x -- :: Leert die Stacks und bricht die Ausführung ab.
abort" :: flag "ccc<quote>" -- :: Bricht mit der Meldung ccc ab, wenn flag wahr ist.
throw :: k*x n -- k*x | i*x n :: Löst die Ausnahme n aus, wenn n ungleich 0 ist.
catch :: i*x xt -- j*x 0 | i*x n :: Führt xt aus und fängt Ausnahmen ab.
words :: -- :: Listet die Wörter der ersten Wortliste der Suchreihenfolge auf.
see :: "name" -- :: Zeigt die Definition von name an.
locate :: "name" -- :: Zeigt den Quelltext von name an (gforth).
forget :: "name" -- :: Entfernt name und alle späteren Definitionen (veraltet).
.s :: -- :: Zeigt den Inhalt des Datenstacks an, ohne ihn zu verändern.
dump :: addr u -- :: Zeigt u Adresseinheiten Speicher ab addr an.
? :: a-addr -- :: Zeigt den Inhalt der Zelle an der Adresse an.
~~ :: -- :: Gibt Quelltextposition und Stackinhalt zur Fehlersuche aus (gforth).
also :: -- :: Dupliziert die erste Wortliste der Suchreihenfolge.
only :: -- :: Setzt die Suchreihenfolge auf das Minimum zurück.
previous :: -- :: Entfernt die erste Wortliste aus der Suchreihenfolge.
forth :: -- :: Ersetzt die erste Wortliste der Suchreihenfolge durch FORTH.
definitions :: -- :: Macht die erste Wortliste der Suchreihenfolge zur Übersetzungswortliste.
order :: -- :: Zeigt die Suchreihenfolge an.
wordlist :: -- wid :: Erzeugt eine neue, leere Wortliste.
vocabulary :: "name" -- :: Definiert ein Vokabular name (gforth).
get-current :: -- wid :: Liefert die Übersetzungswortliste.
set-current :: wid -- :: Setzt die Übersetzungswortliste.
get-order :: -- widn ... wid1 n :: Liefert die Suchreihenfolge.
set-order :: widn ... wid1 n -- :: Setzt die Suchreihenfolge.
search-wordlist :: c-addr u wid -- 0 | xt 1 | xt -1 :: Sucht ein Wort in der Wortliste wid.
`,
  Zeichenketten: `
s" :: "ccc<quote>" -- c-addr u :: Zeichenkette ccc; liefert Adresse und Länge.
s\\" :: "ccc<quote>" -- c-addr u :: Wie s", mit Escape-Sequenzen (\\n, \\t, \\" ...).
c" :: "ccc<quote>" -- c-addr :: Zeichenkette ccc als counted string.
." :: "ccc<quote>" -- :: Gibt die Zeichenkette ccc aus.
.\\" :: "ccc<quote>" -- :: Wie .", mit Escape-Sequenzen (gforth).
.( :: "ccc<paren>" -- :: Gibt den Text bis zur schließenden Klammer sofort aus.
count :: c-addr1 -- c-addr2 u :: Wandelt eine counted string in Adresse und Länge um.
compare :: c-addr1 u1 c-addr2 u2 -- n :: Vergleicht zwei Zeichenketten (-1, 0 oder 1).
str= :: c-addr1 u1 c-addr2 u2 -- flag :: Wahr, wenn beide Zeichenketten gleich sind (gforth).
str< :: c-addr1 u1 c-addr2 u2 -- flag :: Wahr, wenn die erste Zeichenkette kleiner ist (gforth).
string-prefix? :: c-addr1 u1 c-addr2 u2 -- flag :: Wahr, wenn die zweite Zeichenkette Präfix der ersten ist (gforth).
search :: c-addr1 u1 c-addr2 u2 -- c-addr3 u3 flag :: Sucht die zweite Zeichenkette in der ersten.
/string :: c-addr1 u1 n -- c-addr2 u2 :: Schneidet n Zeichen am Anfang der Zeichenkette ab.
-trailing :: c-addr u1 -- c-addr u2 :: Entfernt Leerzeichen am Ende der Zeichenkette.
scan :: c-addr1 u1 char -- c-addr2 u2 :: Überspringt Zeichen bis zum ersten Vorkommen von char (gforth).
skip :: c-addr1 u1 char -- c-addr2 u2 :: Überspringt führende Zeichen char (gforth).
place :: c-addr1 u c-addr2 -- :: Speichert die Zeichenkette als counted string an c-addr2 (gforth).
+place :: c-addr1 u c-addr2 -- :: Hängt die Zeichenkette an die counted string an c-addr2 an (gforth).
s+ :: c-addr1 u1 c-addr2 u2 -- c-addr3 u3 :: Verkettet zwei Zeichenketten in neuem Speicher (gforth).
toupper :: char1 -- char2 :: Wandelt ein Zeichen in einen Großbuchstaben um (gforth).
>number :: ud1 c-addr1 u1 -- ud2 c-addr2 u2 :: Wandelt Ziffern der Zeichenkette in eine Zahl um und akkumuliert in ud.
s>number? :: c-addr u -- d flag :: Wandelt eine Zeichenkette in eine doppelt genaue Zahl um (gforth).
s>unumber? :: c-addr u -- ud flag :: Wie s>number?, vorzeichenlos (gforth).
$! :: c-addr u $addr -- :: Speichert die Zeichenkette in der dynamischen String-Variable (gforth).
$@ :: $addr -- c-addr u :: Liest die dynamische String-Variable (gforth).
$+! :: c-addr u $addr -- :: Hängt die Zeichenkette an die dynamische String-Variable an (gforth).
bl :: -- char :: Zeichencode des Leerzeichens (32).
`,
  'Ein- und Ausgabe': `
emit :: char -- :: Gibt ein Zeichen aus.
type :: c-addr u -- :: Gibt die Zeichenkette aus.
cr :: -- :: Gibt einen Zeilenumbruch aus.
space :: -- :: Gibt ein Leerzeichen aus.
spaces :: n -- :: Gibt n Leerzeichen aus.
page :: -- :: Löscht den Bildschirm.
at-xy :: u1 u2 -- :: Setzt den Cursor auf Spalte u1, Zeile u2.
key :: -- char :: Wartet auf einen Tastendruck und liefert das Zeichen.
key? :: -- flag :: Wahr, wenn ein Tastendruck vorliegt.
accept :: c-addr +n1 -- +n2 :: Liest eine Eingabezeile mit höchstens n1 Zeichen.
ms :: u -- :: Wartet u Millisekunden.
time&date :: -- +n1 +n2 +n3 +n4 +n5 +n6 :: Liefert Sekunde, Minute, Stunde, Tag, Monat, Jahr.
utime :: -- d :: Aktuelle Zeit in Mikrosekunden seit der Epoche (gforth).
. :: n -- :: Gibt eine Zahl mit folgendem Leerzeichen aus.
u. :: u -- :: Gibt eine vorzeichenlose Zahl aus.
.r :: n1 n2 -- :: Gibt n1 rechtsbündig in einem Feld der Breite n2 aus.
u.r :: u n -- :: Gibt u rechtsbündig in einem Feld der Breite n aus.
d. :: d -- :: Gibt eine doppelt genaue Zahl aus.
ud. :: ud -- :: Gibt eine vorzeichenlose doppelt genaue Zahl aus (gforth).
d.r :: d n -- :: Gibt d rechtsbündig in einem Feld der Breite n aus.
hex. :: u -- :: Gibt u hexadezimal mit $-Präfix aus (gforth).
dec. :: n -- :: Gibt n dezimal aus (gforth).
base :: -- a-addr :: Adresse der aktuellen Zahlenbasis.
hex :: -- :: Stellt die Zahlenbasis auf 16.
decimal :: -- :: Stellt die Zahlenbasis auf 10.
<# :: -- :: Beginnt die formatierte Zahlenausgabe.
# :: ud1 -- ud2 :: Wandelt eine Ziffer um und fügt sie der Ausgabe hinzu.
#s :: ud1 -- ud2 :: Wandelt alle verbleibenden Ziffern um (ud2 ist 0).
#> :: xd -- c-addr u :: Beendet die formatierte Zahlenausgabe; liefert die Zeichenkette.
hold :: char -- :: Fügt ein Zeichen in die formatierte Zahlenausgabe ein.
holds :: c-addr u -- :: Fügt eine Zeichenkette in die formatierte Zahlenausgabe ein.
sign :: n -- :: Fügt ein Minuszeichen ein, wenn n negativ ist.
`,
  Dateien: `
r/o :: -- fam :: Dateizugriffsmodus: nur lesen.
w/o :: -- fam :: Dateizugriffsmodus: nur schreiben.
r/w :: -- fam :: Dateizugriffsmodus: lesen und schreiben.
bin :: fam1 -- fam2 :: Ergänzt den Zugriffsmodus um Binärmodus.
open-file :: c-addr u fam -- fileid ior :: Öffnet eine vorhandene Datei.
create-file :: c-addr u fam -- fileid ior :: Legt eine Datei an (oder leert sie) und öffnet sie.
close-file :: fileid -- ior :: Schließt die Datei.
read-file :: c-addr u1 fileid -- u2 ior :: Liest höchstens u1 Zeichen; u2 ist die gelesene Anzahl.
read-line :: c-addr u1 fileid -- u2 flag ior :: Liest eine Zeile; flag ist falsch am Dateiende.
write-file :: c-addr u fileid -- ior :: Schreibt die Zeichenkette in die Datei.
write-line :: c-addr u fileid -- ior :: Schreibt die Zeichenkette mit Zeilenende in die Datei.
emit-file :: char fileid -- ior :: Schreibt ein Zeichen in die Datei (gforth).
flush-file :: fileid -- ior :: Schreibt gepufferte Daten der Datei auf den Datenträger.
file-size :: fileid -- ud ior :: Größe der Datei als doppelt genaue Zahl.
file-position :: fileid -- ud ior :: Aktuelle Position in der Datei.
reposition-file :: ud fileid -- ior :: Setzt die Position in der Datei.
resize-file :: ud fileid -- ior :: Ändert die Größe der Datei.
delete-file :: c-addr u -- ior :: Löscht die Datei.
rename-file :: c-addr1 u1 c-addr2 u2 -- ior :: Benennt die Datei um.
file-status :: c-addr u -- x ior :: Liefert Statusinformationen zur Datei.
slurp-file :: c-addr1 u1 -- c-addr2 u2 :: Liest die gesamte Datei in neu angeforderten Speicher (gforth).
stdin :: -- fileid :: Standardeingabe (gforth).
stdout :: -- fileid :: Standardausgabe (gforth).
stderr :: -- fileid :: Standardfehlerausgabe (gforth).
`,
  Gleitkomma: `
f+ :: F: r1 r2 -- r3 :: Gleitkomma-Addition.
f- :: F: r1 r2 -- r3 :: Gleitkomma-Subtraktion.
f* :: F: r1 r2 -- r3 :: Gleitkomma-Multiplikation.
f/ :: F: r1 r2 -- r3 :: Gleitkomma-Division.
f** :: F: r1 r2 -- r3 :: Potenz r1 hoch r2.
fnegate :: F: r1 -- r2 :: Vorzeichenwechsel.
fabs :: F: r1 -- r2 :: Absolutbetrag.
fsqrt :: F: r1 -- r2 :: Quadratwurzel.
fmin :: F: r1 r2 -- r3 :: Kleinerer der beiden Werte.
fmax :: F: r1 r2 -- r3 :: Größerer der beiden Werte.
floor :: F: r1 -- r2 :: Rundet auf die nächstkleinere ganze Zahl ab.
fround :: F: r1 -- r2 :: Rundet auf die nächste ganze Zahl.
fsin :: F: r1 -- r2 :: Sinus.
fcos :: F: r1 -- r2 :: Kosinus.
ftan :: F: r1 -- r2 :: Tangens.
fexp :: F: r1 -- r2 :: Exponentialfunktion.
fln :: F: r1 -- r2 :: Natürlicher Logarithmus.
flog :: F: r1 -- r2 :: Dekadischer Logarithmus.
fdup :: F: r -- r r :: Dupliziert den obersten Gleitkommawert.
fdrop :: F: r -- :: Entfernt den obersten Gleitkommawert.
fswap :: F: r1 r2 -- r2 r1 :: Vertauscht die beiden obersten Gleitkommawerte.
fover :: F: r1 r2 -- r1 r2 r1 :: Kopiert den zweiten Gleitkommawert nach oben.
frot :: F: r1 r2 r3 -- r2 r3 r1 :: Rotiert den dritten Gleitkommawert nach oben.
f@ :: f-addr -- ) ( F: -- r :: Liest einen Gleitkommawert von der Adresse.
f! :: f-addr -- ) ( F: r -- :: Schreibt einen Gleitkommawert an die Adresse.
f. :: F: r -- :: Gibt einen Gleitkommawert aus.
fe. :: F: r -- :: Gibt einen Gleitkommawert in technischer Notation aus.
fs. :: F: r -- :: Gibt einen Gleitkommawert in wissenschaftlicher Notation aus.
f0= :: -- flag ) ( F: r -- :: Wahr, wenn r gleich 0 ist.
f0< :: -- flag ) ( F: r -- :: Wahr, wenn r negativ ist.
f< :: -- flag ) ( F: r1 r2 -- :: Wahr, wenn r1 kleiner als r2 ist.
f= :: -- flag ) ( F: r1 r2 -- :: Wahr, wenn r1 gleich r2 ist (gforth).
d>f :: d -- ) ( F: -- r :: Wandelt eine doppelt genaue Zahl in einen Gleitkommawert um.
f>d :: -- d ) ( F: r -- :: Wandelt einen Gleitkommawert in eine doppelt genaue Zahl um.
s>f :: n -- ) ( F: -- r :: Wandelt eine einfache Zahl in einen Gleitkommawert um.
f>s :: -- n ) ( F: r -- :: Wandelt einen Gleitkommawert in eine einfache Zahl um.
>float :: c-addr u -- true | false ) ( F: -- r | :: Wandelt eine Zeichenkette in einen Gleitkommawert um.
fvariable :: "name" -- :: Definiert eine Gleitkomma-Variable.
fconstant :: "name" -- ) ( F: r -- :: Definiert eine Gleitkomma-Konstante.
fvalue :: "name" -- ) ( F: r -- :: Definiert einen Gleitkomma-Wert, änderbar mit to.
ffield: :: n1 "name" -- n2 :: Definiert ein Gleitkomma-Strukturfeld.
fliteral :: F: r -- :: Kompiliert r als Gleitkomma-Literal.
float+ :: f-addr1 -- f-addr2 :: Erhöht die Adresse um die Größe eines Gleitkommawerts.
floats :: n1 -- n2 :: Größe von n1 Gleitkommawerten in Adresseinheiten.
falign :: -- :: Richtet den Datenbereichszeiger auf eine Gleitkommagrenze aus.
faligned :: addr -- f-addr :: Rundet die Adresse auf die nächste Gleitkommagrenze auf.
fdepth :: -- +n :: Anzahl der Werte auf dem Gleitkommastack.
pi :: F: -- r :: Die Kreiszahl Pi (gforth).
`,
  gforth: `
next-arg :: -- c-addr u :: Liefert das nächste Kommandozeilenargument (Länge 0, wenn keines mehr vorhanden ist).
arg :: u -- c-addr u :: Liefert das u-te Kommandozeilenargument.
argc :: -- a-addr :: Variable mit der Anzahl der Kommandozeilenargumente.
shift-args :: -- :: Entfernt das erste Kommandozeilenargument.
system :: c-addr u -- :: Führt die Zeichenkette als Betriebssystemkommando aus.
sh :: "..." -- :: Führt den Rest der Zeile als Betriebssystemkommando aus.
getenv :: c-addr1 u1 -- c-addr2 u2 :: Liefert den Wert der Umgebungsvariable.
cputime :: -- d1 d2 :: Verbrauchte CPU-Zeit in Mikrosekunden.
assert( :: -- :: Beginnt eine Zusicherung; der Ausdruck bis ) muss wahr ergeben.
) :: flag -- :: Beendet eine mit assert( begonnene Zusicherung; flag muss wahr sein.
nextname :: c-addr u -- :: Legt den Namen für das nächste definierende Wort fest.
execute-parsing :: i*x c-addr u xt -- j*x :: Führt xt mit der Zeichenkette als Eingabepuffer aus.
>name :: xt -- nt | 0 :: Liefert das Name Token zu einem Execution Token.
id. :: nt -- :: Gibt den Namen zum Name Token aus.
xt-see :: xt -- :: Zeigt die Definition zu einem Execution Token an.
[: :: -- :: Beginnt eine Quotation (namenlose Definition innerhalb einer Definition).
;] :: -- xt :: Beendet eine Quotation; liefert zur Laufzeit deren xt.
`,
};

function buildTable(): Map<string, BuiltinWord> {
  const words = new Map<string, BuiltinWord>();
  for (const [category, block] of Object.entries(TABLE)) {
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split(' :: ');
      const name = parts[0].trim();
      const stack = (parts[1] ?? '').trim();
      const description = (parts[2] ?? '').trim();
      // Float words never get a data stack effect: analysing them would require
      // tracking the float stack as well.
      const effect = category === 'Gleitkomma' ? null : parseStackEffect(`( ${stack} )`);
      words.set(name.toLowerCase(), { name, stack, description, category, effect });
    }
  }
  return words;
}

export const BUILTINS: ReadonlyMap<string, BuiltinWord> = buildTable();

export function getBuiltin(name: string): BuiltinWord | undefined {
  return BUILTINS.get(name.toLowerCase());
}

/** Standard defining words: they parse the next token as the name of a new word. */
export const DEFINERS: ReadonlySet<string> = new Set([
  ':', 'code', 'variable', '2variable', 'fvariable', 'constant', '2constant', 'fconstant',
  'value', '2value', 'fvalue', 'create', 'defer', 'user', 'buffer:', 'marker', 'synonym',
  'alias', 'vocabulary', 'field:', 'cfield:', 'ffield:', '2field:', '+field', 'field',
  'begin-structure', 'end-struct',
]);

/** Immediate words that parse the next token even inside a colon definition. */
export const IMMEDIATE_PARSERS: ReadonlySet<string> = new Set([
  '[char]', "[']", 'postpone', '[compile]', 'to', '+to', 'is', 'action-of',
  '[defined]', '[undefined]', '[ifdef]', '[ifundef]',
]);

/** Non-immediate words that parse the next token when interpreted. */
export const INTERPRET_PARSERS: ReadonlySet<string> = new Set([
  'char', "'", 'include', 'require', 'needs', 'see', 'locate', 'forget',
]);

/** Standard words that start a string running up to the next double quote. */
export const STRING_WORDS: ReadonlySet<string> = new Set(['s"', '."', 'c"', 'abort"', 's\\"', '.\\"', ',"']);
